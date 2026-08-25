// db.js - Unified Database Layer for LTAX Offline
// ใช้ IndexedDB (ltax_db) เก็บข้อมูลทั้งหมด — ไม่ใช้ localStorage
// โมเดล (v2): แต่ละ store เก็บ "1 record ต่อ 1 แถว"
//   - set(store, list)   = แทนที่ทั้ง store ด้วยอาเรย์ของ record
//   - saveSurvey/updateSurvey/getAllSurveys ทำงานเป็นอาเรย์ตามลำดับแถว
// (v1 เดิมเก็บ "ทั้งลิสต์เป็นแถวเดียว" ด้วย put() ซึ่งสะสม snapshot ซ้ำทุกครั้ง
//  — onupgradeneeded ของ v2 จะย้ายแถวสุดท้าย = ลิสต์ล่าสุด มาเป็น 1 record/แถว)

class LTAXDB {
    constructor() {
        this.dbName = 'ltax_db';
        this.version = 2;
        this.initialized = false;
        this.db = null;
    }

    async init() {
        if (this.initialized) return;
        // กันเรียกซ้อน: ถ้ามี init() กำลังทำงานอยู่แล้ว ให้รอ promise เดิม
        // แทนที่จะเปิด indexedDB.open() ซ้ำ (ซึ่งจะโดน "blocked" เงียบๆ
        // ระหว่างที่ connection แรกกำลังรัน onupgradeneeded อยู่ — ไม่มี error,
        // ไม่มี resolve, ค้างไปเรื่อยๆ)
        if (!this._initPromise) {
            this._initPromise = this.initIndexedDB().then(() => {
                this.initialized = true;
            }).catch((err) => {
                this._initPromise = null; // เปิดทางให้ลองใหม่ได้ถ้ารอบแรกล้มเหลว
                throw err;
            });
        }
        return this._initPromise;
    }

    initIndexedDB() {
        const stores = LTAXDB.STORE_NAMES;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const tx = event.target.transaction;

                stores.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                        return;
                    }
                    if (event.oldVersion >= 2) return;

                    // ย้ายข้อมูล v1 (แถวละหนึ่งลิสต์ทั้งก้อน สะสมซ้ำทุกครั้งที่บันทึก)
                    // แถวสุดท้ายตามลำดับ key = ลิสต์ล่าสุดเสมอ → เก็บเฉพาะรายการในนั้น
                    const store = tx.objectStore(storeName);
                    const rq = store.openCursor();
                    let latest = null;   // ลิสต์ล่าสุดจากโมเดล v1
                    let singles = [];   // แถวที่เป็น record เดี่ยว (เผื่อกรณีพิเศษ)
                    rq.onsuccess = (e) => {
                        const cur = e.target.result;
                        if (!cur) {
                            const records = (latest && latest.length) ? latest : singles;
                            records.forEach(rec => { if (rec != null) store.add(rec); });
                            return;
                        }
                        const v = cur.value;
                        if (Array.isArray(v)) latest = v;
                        else if (v != null) singles.push(v);
                        cur.delete();
                        cur.continue();
                    };
                });
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.db.onversionchange = () => this.db.close();
                resolve();
            };

            request.onerror = (event) => {
                console.error('IndexedDB init error:', event.target.error);
                reject(event.target.error);
            };

            request.onblocked = () => {
                console.error('IndexedDB blocked: มีแท็บ/หน้าต่างอื่นเปิด ltax_db เวอร์ชันเก่าค้างอยู่ กรุณาปิดแท็บอื่นแล้วรีเฟรชหน้านี้');
                reject(new Error('IndexedDB ถูก block โดย connection อื่น — กรุณาปิดแท็บอื่นที่เปิดหน้านี้อยู่แล้วลองใหม่'));
            };
        });
    }

    async get(storeName, key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    // แทนที่ทั้ง store ด้วยอาเรย์ของ record (1 record ต่อ 1 แถว)
    async set(storeName, list) {
        await this.init();
        if (!Array.isArray(list)) {
            return Promise.reject(new Error('set() รับค่าเป็นอาเรย์ของ record เท่านั้น'));
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            store.clear();
            list.forEach(rec => { if (rec != null) store.add(rec); });

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('transaction aborted'));
        });
    }

    async add(storeName, item) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(item);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, key) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async clear(storeName) {
        await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== รายชื่อ store =====
    static get STORE_NAMES() {
        return [
            'ltax_owner', 'ltax_land', 'ltax_land_usage',
            'ltax_building', 'ltax_building_usage', 'ltax_sign',
            'ltax_photos', 'ltax_ref_owner'
        ];
    }

    // ===== เมธอดระดับสูง: ทำงานกับ store แบบอาเรย์ของ record =====

    // บันทึกรายการสำรวจใหม่ (push เข้าอาเรย์)
    async saveSurvey(storeName, record) {
        await this.init();
        const list = await this.getAll(storeName);
        list.push(record);
        await this.set(storeName, list);
        return list.length - 1;
    }

    // อัปเดตรายการสำรวจตาม index
    async updateSurvey(storeName, index, record) {
        await this.init();
        const list = await this.getAll(storeName);
        if (index >= 0 && index < list.length) {
            list[index] = record;
        } else {
            list.push(record);
        }
        await this.set(storeName, list);
        return list[index] || record;
    }

    // ดึงทุกรายการใน store
    async getAllSurveys(storeName) {
        return await this.getAll(storeName);
    }

    // ดึงรายการตาม index
    async getSurvey(storeName, index) {
        const list = await this.getAll(storeName);
        return (index >= 0 && index < list.length) ? list[index] : null;
    }
}

// สร้าง instance global
window.LTAXDB = new LTAXDB();

// Utility functions สำหรับ compatibility กับ code เดิม
window.LTAX_getList = async (key) => {
    return await window.LTAXDB.getAll(key);
};

window.LTAX_saveList = async (key, data) => {
    return await window.LTAXDB.set(key, data);
};

// Initialize เมื่อโหลดหน้า
window.addEventListener('load', () => {
    window.LTAXDB.init().catch(console.error);
});
