/* =========================================================
   db_helpers.js — ตัวช่วยสำหรับการย้ายจาก localStorage ไปยัง LTAXDB
   ========================================================= */

// ฟังก์ชันสำหรับการย้ายข้อมูลจาก localStorage ไปยัง IndexedDB
function migrateToLTAXDB() {
  if (!window.LTAXDB) {
    console.error('LTAXDB ไม่พร้อมใช้งาน');
    return Promise.resolve(false);
  }
  
  return LTAXDB.migrateFromLocalStorage()
    .then(function(results) {
      var migrated = 0;
      results.forEach(function(r) {
        if (r.migrated > 0) {
          console.log('ย้ายข้อมูล ' + r.store + ': ' + r.migrated + ' รายการ');
          migrated += r.migrated;
        }
      });
      
      if (migrated > 0) {
        console.log('ย้ายข้อมูลสำเร็จทั้งหมด ' + migrated + ' รายการ');
        // ลบข้อมูลเก่าจาก localStorage
        LTAXDB.STORE_NAMES.forEach(function(storeName) {
          try { localStorage.removeItem(storeName); } catch(e) {}
        });
      }
      return migrated > 0;
    })
    .catch(function(err) {
      console.error('ย้ายข้อมูลไม่สำเร็จ:', err);
      return false;
    });
}

// ฟังก์ชันสำหรับการบันทึกข้อมูลผ่าน LTAXDB แทน localStorage
function LTAXDB_store(key, record) {
  if (!window.LTAXDB) {
    console.error('LTAXDB ไม่พร้อมใช้งาน');
    return Promise.reject(new Error('LTAXDB ไม่พร้อมใช้งาน'));
  }
  
  return LTAXDB.saveSurvey(key, record)
    .then(function(id) {
      console.log('บันทึกข้อมูลสำเร็จใน ' + key + ' (id=' + id + ')');
      return id;
    })
    .catch(function(err) {
      console.error('บันทึกข้อมูลไม่สำเร็จ:', err);
      throw err;
    });
}

// ฟังก์ชันสำหรับการโหลดข้อมูลผ่าน LTAXDB แทน localStorage
function LTAXDB_getAll(key) {
  if (!window.LTAXDB) {
    console.error('LTAXDB ไม่พร้อมใช้งาน');
    return Promise.resolve([]);
  }
  
  return LTAXDB.getAllSurveys(key)
    .catch(function(err) {
      console.error('โหลดข้อมูลไม่สำเร็จ:', err);
      return [];
    });
}

// ฟังก์ชันสำหรับการโหลดข้อมูลแก้ไขผ่าน LTAXDB
function LTAXDB_loadEditRecord(key, idx) {
  if (!window.LTAXDB) {
    console.error('LTAXDB ไม่พร้อมใช้งาน');
    return Promise.resolve(null);
  }
  
  return LTAXDB.getSurvey(key, idx)
    .then(function(record) {
      return record;
    })
    .catch(function(err) {
      console.error('โหลดข้อมูลแก้ไขไม่สำเร็จ:', err);
      return null;
    });
}

// ตรวจสอบและย้ายข้อมูลอัตโนมัติเมื่อเปิดหน้าเว็บ
function autoMigrateData() {
  if (!window.LTAXDB) return;
  
  // ตรวจสอบว่ามีข้อมูลใน localStorage หรือไม่
  var hasLocalData = false;
  LTAXDB.STORE_NAMES.forEach(function(storeName) {
    try {
      var data = localStorage.getItem(storeName);
      if (data && data !== '[]' && data !== 'null') {
        hasLocalData = true;
      }
    } catch(e) {}
  });
  
  if (hasLocalData) {
    console.log('พบข้อมูลใน localStorage กำลังย้ายไปยัง LTAXDB...');
    migrateToLTAXDB();
  }
}

// เรียกย้ายข้อมูลอัตโนมัติเมื่อโหลดหน้า
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMigrateData);
} else {
  autoMigrateData();
}