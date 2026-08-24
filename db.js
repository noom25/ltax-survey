// db.js - Unified Database Layer for LTAX Offline
// รองรับทั้ง localStorage และ IndexedDB (ถ้าเบราว์เซอร์สนับสนุน)

class LTAXDB {
    constructor() {
        this.backend = this.detectBackend();
        this.dbName = 'ltax_db';
        this.version = 1;
        this.initialized = false;
    }

    detectBackend() {
        // ตรวจสอบว่าเบราว์เซอร์รองรับ IndexedDB หรือไม่
        if (window.indexedDB && typeof window.indexedDB.open === 'function') {
            return 'indexeddb';
        }
        return 'localstorage';
    }

    async init() {
        if (this.initialized) return;
        
        if (this.backend === 'indexeddb') {
            await this.initIndexedDB();
        }
        
        this.initialized = true;
    }

    initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // สร้าง object stores สำหรับข้อมูลทั้งหมด
                const stores = [
                    'ltax_owner', 'ltax_land', 'ltax_land_usage',
                    'ltax_building', 'ltax_building_usage', 'ltax_sign',
                    'ltax_photos', 'ltax_ref_owner'
                ];
                
                stores.forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                    }
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

    async get(storeName, key) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                const data = localStorage.getItem(storeName);
                return data ? JSON.parse(data) : null;
            } catch (e) {
                console.error('LocalStorage get error:', e);
                return null;
            }
        }
    }

    async getAll(storeName) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                const data = localStorage.getItem(storeName);
                return data ? JSON.parse(data) : [];
            } catch (e) {
                console.error('LocalStorage getAll error:', e);
                return [];
            }
        }
    }

    async set(storeName, data) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                localStorage.setItem(storeName, JSON.stringify(data));
                return Promise.resolve();
            } catch (e) {
                console.error('LocalStorage set error:', e);
                return Promise.reject(e);
            }
        }
    }

    async add(storeName, item) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.add(item);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                const currentData = await this.getAll(storeName);
                currentData.push(item);
                await this.set(storeName, currentData);
                return Promise.resolve();
            } catch (e) {
                console.error('LocalStorage add error:', e);
                return Promise.reject(e);
            }
        }
    }

    async delete(storeName, key) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                const currentData = await this.getAll(storeName);
                const newData = currentData.filter(item => item.id !== key);
                await this.set(storeName, newData);
                return Promise.resolve();
            } catch (e) {
                console.error('LocalStorage delete error:', e);
                return Promise.reject(e);
            }
        }
    }

    async clear(storeName) {
        await this.init();
        
        if (this.backend === 'indexeddb') {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } else {
            // Fallback to localStorage
            try {
                localStorage.removeItem(storeName);
                return Promise.resolve();
            } catch (e) {
                console.error('LocalStorage clear error:', e);
                return Promise.reject(e);
            }
        }
    }

    // ===== รายชื่อ store (อิงจาก db_helpers.js) =====
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
        // เขียนลง localStorage เสมอด้วย (backward compat สำหรับฟอร์มที่ยังอ่านจาก localStorage โดยตรง)
        try { localStorage.setItem(storeName, JSON.stringify(list)); } catch (e) {}
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
        try { localStorage.setItem(storeName, JSON.stringify(list)); } catch (e) {}
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

    // ย้ายข้อมูลจาก localStorage มา LTAXDB
    async migrateFromLocalStorage() {
        await this.init();
        const results = [];
        const stores = LTAXDB.STORE_NAMES;

        for (const storeName of stores) {
            try {
                const raw = localStorage.getItem(storeName);
                if (!raw || raw === 'null') { results.push({ store: storeName, migrated: 0 }); continue; }
                const data = JSON.parse(raw);
                if (!Array.isArray(data) || data.length === 0) { results.push({ store: storeName, migrated: 0 }); continue; }
                
                // เก็บลง LTAXDB (IndexedDB หรือ localStorage fallback)
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