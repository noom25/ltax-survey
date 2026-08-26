// db.js - Unified Database Layer for LTAX Offline
// เก็บข้อมูลทั้งหมดผ่าน IndexedDB (fallback เป็น localStorage เฉพาะเบราว์เซอร์ที่ไม่รองรับ IndexedDB จริง ๆ)
//
// สคีมา: แต่ละ store เก็บ "รายการทั้งหมดของหมวดนั้น" เป็นก้อนอาเรย์เดียว ภายใต้คีย์คงที่ (KEY)
// object store สร้างแบบ out-of-line key (ไม่ใช้ keyPath/autoIncrement) — สำคัญ: ห้ามใช้ keyPath
// เพราะ store.put(arrayทั้งก้อน) กับ store ที่มี keyPath จะทำให้ IndexedDB พยายามอ่านคีย์จากตัวอาเรย์เอง
// (ซึ่งไม่มี) แล้วสร้าง entry ใหม่ทุกครั้งที่บันทึก → ข้อมูลซ้อนกันเป็นขยะ (บั๊กเดิมของไฟล์นี้)

class LTAXDB {
    constructor() {
        this.backend = this.detectBackend();
        this.dbName = 'ltax_db';
        this.version = 2; // v2: แก้สคีมา (out-of-line key) — เดิม v1 ใช้ keyPath ผิดจนข้อมูลซ้อนกันเสีย
        this.initialized = false;
        this.initPromise = null;
        this.KEY = '__all__';
    }

    detectBackend() {
        if (window.indexedDB && typeof window.indexedDB.open === 'function') {
            return 'indexeddb';
        }
        return 'localstorage';
    }

    init() {
        if (this.initialized) return Promise.resolve();
        if (this.initPromise) return this.initPromise;
        if (this.backend !== 'indexeddb') { this.initialized = true; return Promise.resolve(); }
        this.initPromise = this.initIndexedDB().then(() => { this.initialized = true; });
        return this.initPromise;
    }

    initIndexedDB() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = LTAXDB.STORE_NAMES;
                stores.forEach((storeName) => {
                    // ลบ store เก่าทิ้งก่อนถ้ามี (กันสคีมาเก่า v1 ที่ใช้ keyPath ผิด — ไม่สามารถแก้ keyPath
                    // ของ store เดิมได้ ต้องลบแล้วสร้างใหม่เท่านั้น)
                    if (db.objectStoreNames.contains(storeName)) {
                        db.deleteObjectStore(storeName);
                    }
                    db.createObjectStore(storeName); // out-of-line key — เก็บด้วย put(value, key) เอง
                });
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                console.error('IndexedDB init error:', event.target.error);
                this.backend = 'localstorage';
                resolve();
            };
        });
    }

    // ===== เมธอดพื้นฐาน: ทั้ง store ถือค่าเดียว (อาเรย์) ภายใต้คีย์คงที่ =====

    async get(storeName) {
        await this.init();
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([storeName], 'readonly');
                const req = tx.objectStore(storeName).get(this.KEY);
                req.onsuccess = () => resolve(req.result === undefined ? [] : req.result);
                req.onerror = () => reject(req.error);
            });
        }
        try {
            const data = localStorage.getItem(storeName);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('LocalStorage get error:', e);
            return [];
        }
    }

    async set(storeName, data) {
        await this.init();
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([storeName], 'readwrite');
                tx.objectStore(storeName).put(data, this.KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
        try {
            localStorage.setItem(storeName, JSON.stringify(data));
            return Promise.resolve();
        } catch (e) {
            console.error('LocalStorage set error:', e);
            return Promise.reject(e);
        }
    }

    async clear(storeName) {
        await this.init();
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction([storeName], 'readwrite');
                tx.objectStore(storeName).delete(this.KEY);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        }
        try {
            localStorage.removeItem(storeName);
            return Promise.resolve();
        } catch (e) {
            return Promise.reject(e);
        }
    }

    // ===== รายชื่อ store ทั้งหมด =====
    static get STORE_NAMES() {
        return [
            'ltax_owner', 'ltax_land', 'ltax_land_usage',
            'ltax_building', 'ltax_building_usage', 'ltax_sign',
            'ltax_photos', 'ltax_ref_owner'
        ];
    }

    // ===== เมธอดระดับสูง: ทำงานกับ store แบบอาเรย์ของ record =====

    async saveSurvey(storeName, record) {
        const list = await this.get(storeName);
        list.push(record);
        await this.set(storeName, list);
        return list.length - 1;
    }

    async updateSurvey(storeName, index, record) {
        const list = await this.get(storeName);
        if (index >= 0 && index < list.length) {
            list[index] = record;
        } else {
            list.push(record);
        }
        await this.set(storeName, list);
        return record;
    }

    async getAllSurveys(storeName) {
        return await this.get(storeName);
    }

    async getSurvey(storeName, index) {
        const list = await this.get(storeName);
        return (index >= 0 && index < list.length) ? list[index] : null;
    }

    async deleteSurvey(storeName, index) {
        const list = await this.get(storeName);
        if (index >= 0 && index < list.length) list.splice(index, 1);
        await this.set(storeName, list);
        return list;
    }

    // ย้ายข้อมูลจาก localStorage มา LTAXDB (ใช้ครั้งเดียวตอนอัปเกรดจากเวอร์ชันเก่า)
    async migrateFromLocalStorage() {
        await this.init();
        const results = [];
        for (const storeName of LTAXDB.STORE_NAMES) {
            try {
                const raw = localStorage.getItem(storeName);
                if (!raw || raw === 'null') { results.push({ store: storeName, migrated: 0 }); continue; }
                const data = JSON.parse(raw);
                if (!Array.isArray(data) || data.length === 0) { results.push({ store: storeName, migrated: 0 }); continue; }

                // ไม่ทับข้อมูลที่มีอยู่แล้วใน IndexedDB (ถ้ามีแล้วแปลว่าย้ายไปแล้วหรือมีข้อมูลใหม่กว่า)
                const existing = await this.get(storeName);
                if (existing && existing.length > 0) { results.push({ store: storeName, migrated: 0, skipped: true }); continue; }

                await this.set(storeName, data);
                results.push({ store: storeName, migrated: data.length });
            } catch (e) {
                console.error('Migrate error for ' + storeName + ':', e);
                results.push({ store: storeName, migrated: 0, error: e.message });
            }
        }
        return results;
    }
}

// สร้าง instance global
window.LTAXDB = new LTAXDB();

/* =========================================================
   ฟังก์ชันช่วยระดับ global (ใช้ร่วมกันทุกฟอร์ม) — ทั้งหมดคุยผ่าน LTAXDB (IndexedDB)
   ========================================================= */

// ดึงรายการทั้งหมดของ store หนึ่ง ๆ
window.LTAX_getAll = function (storeName) {
    return window.LTAXDB.getAllSurveys(storeName);
};

// เขียนทับรายการทั้งหมดของ store (ใช้ตอนลบ/จัดเรียงใหม่)
window.LTAX_setAll = function (storeName, arr) {
    return window.LTAXDB.set(storeName, arr || []);
};

// บันทึกฟอร์ม: เพิ่มใหม่ หรืออัปเดตของเดิมถ้าอยู่ในโหมดแก้ไข (window.__editKey/__editIdx)
// อ่านค่า editKey/editIdx แล้ว "เคลียร์ทันที" ก่อนเริ่มงาน async — กันปัญหาการกดบันทึกซ้อนหรือ
// โค้ดอื่นมาเช็ค __editKey ระหว่างที่ยังบันทึกไม่เสร็จ
window.LTAX_store = function (key, record) {
    var editKey = window.__editKey, editIdx = window.__editIdx;
    window.__editKey = null;
    window.__editIdx = -1;
    if (editKey === key && editIdx >= 0) {
        return window.LTAXDB.updateSurvey(key, editIdx, record);
    }
    return window.LTAXDB.saveSurvey(key, record);
};

// โหลด record ที่เลือกจากหน้าแรก (ค้นหา/แก้ไข) กลับขึ้นฟอร์ม
// รับ query string (?editKey=...&editIdx=...) → คืน Promise<{key, idx, record} | null>
// ตั้ง window.__editKey/__editIdx แบบ "ทันที (sync)" ก่อน resolve ข้อมูลจริง กันปัญหา
// จังหวะแข่งกับโค้ดอื่นที่รันต่อจากนี้ทันที (เช่น flow ชุดถัดไป) ที่เช็ค __editKey ก่อนข้อมูลโหลดเสร็จ
window.LTAX_loadEditRecord = function (query) {
    var q = query || window.location.search;
    var params = new URLSearchParams(q);
    var key = params.get('editKey');
    var idx = parseInt(params.get('editIdx') || '-1', 10);
    if (!key || idx < 0) return Promise.resolve(null);
    window.__editKey = key;
    window.__editIdx = idx;
    return window.LTAXDB.getSurvey(key, idx).then(function (record) {
        if (!record) { window.__editKey = null; window.__editIdx = -1; return null; }
        return { key: key, idx: idx, record: record };
    });
};

// Initialize เมื่อโหลดหน้า
window.addEventListener('load', function () {
    window.LTAXDB.init().catch(function (err) { console.error('LTAXDB init error:', err); });
});
