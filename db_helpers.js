/* =========================================================
   db_helpers.js — ย้ายข้อมูลเก่าจาก localStorage (เวอร์ชันก่อนหน้า) เข้า LTAXDB (IndexedDB)
   ครั้งเดียวตอนเปิดหน้าเว็บ — ข้อมูลใหม่ทั้งหมดหลังจากนี้บันทึกผ่าน LTAXDB โดยตรง (ดู db.js)
   ========================================================= */

function migrateToLTAXDB() {
  if (!window.LTAXDB) {
    console.error('LTAXDB ไม่พร้อมใช้งาน');
    return Promise.resolve(false);
  }

  return LTAXDB.migrateFromLocalStorage()
    .then(function (results) {
      var migrated = 0;
      results.forEach(function (r) {
        if (r.migrated > 0) {
          console.log('ย้ายข้อมูล ' + r.store + ': ' + r.migrated + ' รายการ');
          migrated += r.migrated;
        }
      });

      if (migrated > 0) {
        console.log('ย้ายข้อมูลสำเร็จทั้งหมด ' + migrated + ' รายการ');
      }
      // ล้าง localStorage เดิมเสมอหลังตรวจสอบ (ไม่ว่าจะย้ายจริงหรือ skip เพราะมีใน IndexedDB แล้ว)
      // กันไม่ให้ข้อมูลเก่าค้างอยู่คู่ขนานและถูกใช้งานผิดที่ผิดทางอีก
      LTAXDB.STORE_NAMES.forEach(function (storeName) {
        try { localStorage.removeItem(storeName); } catch (e) {}
      });
      return migrated > 0;
    })
    .catch(function (err) {
      console.error('ย้ายข้อมูลไม่สำเร็จ:', err);
      return false;
    });
}

function autoMigrateData() {
  if (!window.LTAXDB) return;

  var hasLocalData = false;
  LTAXDB.STORE_NAMES.forEach(function (storeName) {
    try {
      var data = localStorage.getItem(storeName);
      if (data && data !== '[]' && data !== 'null') {
        hasLocalData = true;
      }
    } catch (e) {}
  });

  if (hasLocalData) {
    console.log('พบข้อมูลเก่าใน localStorage กำลังย้ายไปยัง LTAXDB (IndexedDB)...');
    migrateToLTAXDB();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMigrateData);
} else {
  autoMigrateData();
}
