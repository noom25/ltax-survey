/* =========================================================
   photo_store.js — ที่เก็บรูปถ่ายของ LTAX Offline (v2)

   ต่างจากเดิม (ltax_photos_db v1 ที่เก็บ base64 ก้อนใหญ่ในเรคคอร์ดเดียว):
   - แยก 2 store:  meta  = ข้อมูลรูป + ภาพย่อ (เล็ก โหลดทีเดียวทั้งหมดได้)
                   blobs = ตัวไฟล์รูปจริง เป็น Blob (โหลดเฉพาะตอนต้องใช้)
   - แก้ข้อมูลรูป (จับคู่/ยกเลิกจับคู่) ทำที่ meta อย่างเดียว ไม่แตะตัวรูป → รูปไม่มีทางหายจากการแก้รหัส
   - มีสถานะต่อรูป (status: new / exported) และเลขลำดับต่อรหัส (seq) ที่คงที่ ใช้ตั้งชื่อไฟล์ตอนส่งออก
   - ย้ายรูปเดิมจาก ltax_photos_db (v1) มาให้อัตโนมัติ ทีละรูป และลบของเก่าเมื่อเขียนของใหม่สำเร็จแล้วเท่านั้น
   - มีตัวสร้างไฟล์ ZIP (แบบไม่บีบอัด) ในตัว — ไม่ต้องพึ่งไลบรารีภายนอก ใช้ได้ออฟไลน์

   ใช้ var/function ล้วน และป้องกันการโหลดซ้ำ (index.html include ไฟล์นี้ได้โดยไม่ชนกัน)
   ========================================================= */
(function () {
  if (window.PhotoStore) return;

  var DB_NAME = 'ltax_photos_v2';
  var DB_VER = 1;
  var LEGACY_DB = 'ltax_photos_db';

  /* ---------- เปิดฐานข้อมูล ---------- */
  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs'); // out-of-line key = photo id
      };
      rq.onsuccess = function () {
        var db = rq.result;
        db.onversionchange = function () { try { db.close(); } catch (e) {} dbPromise = null; };
        res(db);
      };
      rq.onerror = function () { dbPromise = null; rej(rq.error || new Error('เปิดที่เก็บรูปไม่สำเร็จ')); };
      rq.onblocked = function () { /* รอให้แท็บอื่นปิดการเชื่อมต่อ */ };
    });
    return dbPromise;
  }

  /* รัน transaction แล้วคืนค่าเมื่อ commit สำเร็จจริง (ไม่ใช่แค่ request สำเร็จ) */
  function run(stores, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (res, rej) {
        var result;
        var t;
        try {
          t = db.transaction(stores, mode);
        } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(result); };
        t.onerror = function () { rej(t.error || new Error('transaction error')); };
        t.onabort = function () { rej(t.error || new Error('transaction aborted')); };
        try {
          fn(t, function (v) { result = v; });
        } catch (e) {
          try { t.abort(); } catch (e2) {}
          rej(e);
        }
      });
    });
  }

  /* ---------- ข้อมูลรูป (meta) ---------- */
  function listMeta() {
    return run(['meta'], 'readonly', function (t, set) {
      var r = t.objectStore('meta').getAll();
      r.onsuccess = function () { set(r.result || []); };
    });
  }

  function getMeta(id) {
    return run(['meta'], 'readonly', function (t, set) {
      var r = t.objectStore('meta').get(id);
      r.onsuccess = function () { set(r.result || null); };
    });
  }

  function getBlob(id) {
    return run(['blobs'], 'readonly', function (t, set) {
      var r = t.objectStore('blobs').get(id);
      r.onsuccess = function () { set(r.result || null); };
    });
  }

  /* เขียนรูป: ตัวรูป + meta ใน transaction เดียว (สำเร็จทั้งคู่หรือไม่ก็ไม่เขียนเลย) */
  function putPhoto(meta, blob) {
    return run(['meta', 'blobs'], 'readwrite', function (t, set) {
      t.objectStore('blobs').put(blob, meta.id);
      t.objectStore('meta').put(meta);
      set(meta);
    });
  }

  /* เปลี่ยนรหัส/หมวดของรูป → ลำดับ (seq) และสถานะส่งออกต้องเริ่มใหม่ เพราะเป็นรูปของเป้าหมายอื่นแล้ว */
  function applyPatch(old, patch) {
    var m = {};
    var k;
    for (k in old) if (Object.prototype.hasOwnProperty.call(old, k)) m[k] = old[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) m[k] = patch[k];
    var codeChanged = ('code' in patch) && patch.code !== old.code;
    var catChanged = ('category' in patch) && patch.category !== old.category;
    if (codeChanged || catChanged) { m.seq = null; m.status = 'new'; m.exportedAt = null; }
    return m;
  }

  /* อ่าน-แก้-เขียนใน transaction เดียว และแตะเฉพาะ meta */
  function updateMany(ids, patch) {
    return run(['meta'], 'readwrite', function (t, set) {
      var st = t.objectStore('meta');
      var n = 0;
      ids.forEach(function (id) {
        var g = st.get(id);
        g.onsuccess = function () {
          if (!g.result) return;
          st.put(applyPatch(g.result, patch));
          n++;
          set(n);
        };
      });
      set(0);
    });
  }
  function updateMeta(id, patch) { return updateMany([id], patch); }

  function remove(ids) {
    if (!ids || !ids.length) return Promise.resolve(0);
    return run(['meta', 'blobs'], 'readwrite', function (t, set) {
      var m = t.objectStore('meta'), b = t.objectStore('blobs');
      ids.forEach(function (id) { m.delete(id); b.delete(id); });
      set(ids.length);
    });
  }

  function clearAll() {
    return run(['meta', 'blobs'], 'readwrite', function (t) {
      t.objectStore('meta').clear();
      t.objectStore('blobs').clear();
    });
  }

  function markExported(ids) {
    return updateMany(ids, { status: 'exported', exportedAt: Date.now() });
  }

  /* ให้ทุกรูปที่จับคู่แล้วมีเลขลำดับ (seq) ต่อรหัส — ครั้งเดียวต่อรูป แล้วคงที่ตลอด
     ชื่อไฟล์ตอนส่งออกจึงไม่เปลี่ยนระหว่างชุด/ระหว่างวัน */
  function assignSeq() {
    return run(['meta'], 'readwrite', function (t, set) {
      var st = t.objectStore('meta');
      var r = st.getAll();
      r.onsuccess = function () {
        var all = r.result || [];
        var maxSeq = {};
        all.forEach(function (m) {
          if (m.code && m.seq) maxSeq[m.code] = Math.max(maxSeq[m.code] || 0, m.seq);
        });
        var todo = all.filter(function (m) { return m.code && !m.seq; })
                      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        todo.forEach(function (m) {
          maxSeq[m.code] = (maxSeq[m.code] || 0) + 1;
          m.seq = maxSeq[m.code];
          st.put(m);
        });
        set(all);
      };
    });
  }

  function stats() {
    return listMeta().then(function (list) {
      var s = { total: list.length, unmatched: 0, matched: 0, pending: 0, exported: 0, bytes: 0 };
      list.forEach(function (m) {
        s.bytes += m.bytes || 0;
        if (!m.code) { s.unmatched++; return; }
        s.matched++;
        if (m.status === 'exported') s.exported++; else s.pending++;
      });
      return s;
    });
  }

  /* ---------- พื้นที่เก็บข้อมูล ---------- */
  function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then(function (already) {
          if (already) return true;
          return navigator.storage.persist();
        }).catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  }
  function storage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) {
          return { usage: e.usage || 0, quota: e.quota || 0 };
        }).catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  var initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    initPromise = openDb().then(function () { return persist(); }).then(function (p) {
      api.persisted = !!p;
      return p;
    });
    return initPromise;
  }

  /* ---------- แปลงข้อมูลรูป ---------- */
  function dataUrlToBlob(url) {
    var i = url.indexOf(',');
    var head = url.slice(0, i);
    var mime = (/data:([^;,]+)/.exec(head) || [])[1] || 'image/jpeg';
    var bin = atob(url.slice(i + 1));
    var u8 = new Uint8Array(bin.length);
    for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: mime });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function readBuffer(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsArrayBuffer(blob);
    });
  }

  var hasDom = typeof document !== 'undefined' && !!document.createElement;

  function loadImage(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      var settled = false;
      // กันค้าง: ถ้าเบราว์เซอร์ไม่ยิงทั้ง onload/onerror ภายใน 20 วินาที ให้ถือว่าเปิดไม่ได้ (จะเก็บไฟล์ต้นฉบับแทน)
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try { URL.revokeObjectURL(url); } catch (e) {}
        rej(new Error('เปิดไฟล์รูปไม่ทัน (หมดเวลา)'));
      }, 20000);
      img.onload = function () { if (settled) return; settled = true; clearTimeout(timer); res({ img: img, url: url }); };
      img.onerror = function () { if (settled) return; settled = true; clearTimeout(timer); URL.revokeObjectURL(url); rej(new Error('เปิดไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  }
  function canvasToBlob(c, q) {
    return new Promise(function (res, rej) {
      if (c.toBlob) {
        c.toBlob(function (b) { if (b) res(b); else rej(new Error('สร้างไฟล์รูปไม่สำเร็จ (หน่วยความจำไม่พอ?)')); }, 'image/jpeg', q);
      } else {
        try { res(dataUrlToBlob(c.toDataURL('image/jpeg', q))); } catch (e) { rej(e); }
      }
    });
  }
  function drawScaled(img, longSide) {
    var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    var scale = Math.min(1, longSide / Math.max(sw, sh));
    var c = document.createElement('canvas');
    c.width = Math.round(sw * scale) || 1;
    c.height = Math.round(sh * scale) || 1;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  function freeCanvas(c) { try { c.width = 1; c.height = 1; } catch (e) {} }

  /* บีบอัด: ด้านยาว ≤ maxW, JPEG คุณภาพเริ่มต้น q ลดลงทีละ 0.1 จนถึง 0.4 แล้วค่อยลดขนาดลง 15% ถ้ายังเกิน maxBytes */
  function compress(img, maxW, q, maxBytes) {
    var curW = maxW, curQ = q, tries = 0, w = 0, h = 0;
    function once() {
      var c = drawScaled(img, curW);
      w = c.width; h = c.height;
      return canvasToBlob(c, curQ).then(function (b) { freeCanvas(c); return b; }, function (e) { freeCanvas(c); throw e; });
    }
    function loop(b) {
      if (!maxBytes || b.size <= maxBytes || tries >= 10) return { blob: b, w: w, h: h };
      tries++;
      if (curQ > 0.4) curQ = Math.max(0.4, curQ - 0.1); else curW = Math.round(curW * 0.85);
      return once().then(loop);
    }
    return once().then(loop);
  }

  /* ภาพย่อ ~128px เป็น dataURL เล็กๆ (3–5 KB) ไว้แสดงในรายการ */
  function makeThumbFromImage(img) {
    var c = drawScaled(img, 128);
    var u = '';
    try { u = c.toDataURL('image/jpeg', 0.6); } catch (e) { u = ''; }
    freeCanvas(c);
    return u;
  }
  function makeThumb(blob) {
    if (!hasDom) return Promise.resolve('');
    return loadImage(blob).then(function (r) {
      var u = makeThumbFromImage(r.img);
      URL.revokeObjectURL(r.url);
      return u;
    }).catch(function () { return ''; });
  }

  function newId() { return 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

  /* ถ่าย/เพิ่มรูปใหม่: บีบอัด → เก็บ Blob → ทำภาพย่อ
     ถ้าเปิดไฟล์เป็นรูปไม่ได้ จะเก็บไฟล์ต้นฉบับไว้ (raw:true) ดีกว่าให้รูปหาย */
  function addPhoto(file, info) {
    info = info || {};
    var maxW = info.maxW || 1024, q = info.quality || 0.70, maxBytes = info.maxBytes || 800 * 1024;
    var meta = {
      id: newId(), category: info.category || '', code: info.code || '',
      ts: info.ts || Date.now(), lat: info.lat == null ? null : info.lat, lng: info.lng == null ? null : info.lng,
      source: info.source || 'camera', srcKey: info.srcKey || '',
      fileName: info.fileName || (file && file.name) || '', status: 'new', seq: null,
      exportedAt: null, raw: false, ext: 'jpg', thumb: '', bytes: 0, w: 0, h: 0
    };
    return loadImage(file).then(function (r) {
      return compress(r.img, maxW, q, maxBytes).then(function (out) {
        meta.thumb = makeThumbFromImage(r.img);
        URL.revokeObjectURL(r.url);
        meta.bytes = out.blob.size; meta.w = out.w; meta.h = out.h;
        return putPhoto(meta, out.blob);
      }, function (e) { URL.revokeObjectURL(r.url); throw e; });
    }, function () {
      var t = (file && file.type) || '';
      meta.raw = true;
      meta.ext = /png/.test(t) ? 'png' : /heic|heif/.test(t) ? 'heic' : /webp/.test(t) ? 'webp' : 'jpg';
      meta.bytes = file.size || 0;
      return putPhoto(meta, file);
    });
  }


  /* ---------- รูปที่แนบในฟอร์ม (base64 ฝังในเรคคอร์ด) → ย้ายมาเก็บเป็นรูปในที่เก็บรูป ----------
     ที่มา: ฟอร์มการใช้ประโยชน์ที่ดิน / สิ่งปลูกสร้าง / ป้าย มีช่องเลือกรูปจากคลังรูป แล้วฝัง base64 ลงในเรคคอร์ด
     ปัญหา: ทุกหมวดเก็บเป็นอาเรย์ก้อนเดียว ทุกครั้งที่บันทึกต้องอ่าน-เขียนทั้งก้อนรวมรูปทั้งหมด → ช้าลง/ค้างเมื่อมีรูปเยอะ
     วิธี: เขียนรูปลงที่เก็บรูปก่อน ตรวจว่าอ่านกลับได้ครบ แล้วจึงเคลียร์ช่อง base64 ในเรคคอร์ด
           (ถ้าขั้นไหนพลาด เรคคอร์ดคงเดิมทุกอย่าง — ไม่มีทางทำให้รูปหาย) */
  /* โครงสร้างข้อมูลจริง: รูปที่ดินที่เลือกในฟอร์มการใช้ประโยชน์ที่ดิน อยู่ "ในแต่ละรายการใช้ประโยชน์" (record.รายการใช้ประโยชน์[i])
     ส่วนอาคาร/ป้าย อยู่ที่ระดับเรคคอร์ดเอง  — items = ชื่อช่องที่เก็บรายการย่อย (ถ้ามี)
     camera = รูปถ่ายจากหน้าถ่ายรูป (ตามรหัส) ผูกกับเรคคอร์ดระดับนี้ด้วย */
  var F_LAND = { data: 'รูปที่ดิน_data', path: 'Path รูปที่ดิน', files: 'รูปที่ดิน_files', ids: 'รูปที่ดิน_ids' };
  var F_IMG  = { data: 'รูปภาพ_data',    path: 'Path รูปภาพ',    files: 'รูปภาพ_files',    ids: 'รูปภาพ_ids' };
  var FIELD_MAP = {
    'ltax_land':       { codeKey: 'รหัสแปลงที่ดิน',    cat: 'land',     items: null,                camera: true,  fields: [F_LAND] },
    'ltax_land_usage': { codeKey: 'รหัสแปลงที่ดิน',    cat: 'land',     items: 'รายการใช้ประโยชน์', camera: false, fields: [F_LAND] },
    'ltax_building':   { codeKey: 'รหัสสิ่งปลูกสร้าง', cat: 'building', items: null,                camera: true,  fields: [F_IMG] },
    'ltax_sign':       { codeKey: 'รหัสป้าย',          cat: 'sign',     items: null,                camera: true,  fields: [F_IMG] }
  };
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function dataUrlsOf(v) {
    var a = Array.isArray(v) ? v : (v ? [v] : []);
    return a.filter(function (u) { return typeof u === 'string' && u.indexOf('data:image') === 0; });
  }
  /* ตัวถือช่องรูป: เรคคอร์ดเอง หรือแต่ละรายการย่อย */
  function holdersOf(cfg, rec) {
    if (!cfg.items) return [rec];
    return Array.isArray(rec[cfg.items]) ? rec[cfg.items].filter(isObj) : [];
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function hash64(s) {
    var h1 = 0x811c9dc5, h2 = 5381;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619);
      h2 = (Math.imul(h2, 33) + c) | 0;
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  /* id คงที่จาก (หมวด, รหัส, เนื้อรูป) — ทำซ้ำกี่ครั้งก็ได้รูปเดียว และรูปเดียวกันที่ถูกคัดลอกไปหลายเรคคอร์ดรวมเป็นรูปเดียว */
  function formPhotoId(cat, code, url) { return 'f' + hash64(cat + '|' + code + '|' + url) + '_' + url.length.toString(36); }

  function ensureFormPhoto(cat, code, url, origName) {
    var id = formPhotoId(cat, code, url);
    return getMeta(id).then(function (exists) {
      if (exists) return id;
      var blob = dataUrlToBlob(url);
      return makeThumb(blob).then(function (thumb) {
        var meta = {
          id: id, category: cat, code: code, ts: Date.now(), lat: null, lng: null, source: 'form', srcKey: '',
          fileName: typeof origName === 'string' ? origName : '', status: 'new', seq: null, exportedAt: null,
          raw: false, ext: /png/.test(blob.type) ? 'png' : 'jpg', thumb: thumb, bytes: blob.size, w: 0, h: 0
        };
        return putPhoto(meta, blob);
      }).then(function () { return getBlob(id); }).then(function (b) {
        if (!b || b.size !== blob.size) throw new Error('ตรวจรูปที่เพิ่งเก็บไม่ผ่าน');
        return id;
      });
    });
  }

  /* รายการรูปที่ต้องย้ายของเรคคอร์ดหนึ่ง: [{ url, name }] */
  function pendingUrls(cfg, rec) {
    var out = [];
    holdersOf(cfg, rec).forEach(function (h) {
      cfg.fields.forEach(function (f) {
        dataUrlsOf(h[f.data]).forEach(function (u) { out.push({ url: u, name: h[f.path] }); });
      });
    });
    return out;
  }
  /* คืนสำเนาเรคคอร์ดที่เคลียร์ช่อง base64 (เฉพาะรูปที่ isOk) แล้วใส่ id รูปไว้ในช่อง <ชื่อ>_ids แทน — ไม่มีอะไรต้องเปลี่ยนคืน null */
  function applyAbsorb(cfg, rec, code, isOk) {
    var out = null;
    function ensureClone() {
      if (out) return;
      out = {};
      for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) out[k] = rec[k];
      if (cfg.items && Array.isArray(rec[cfg.items])) {
        out[cfg.items] = rec[cfg.items].map(function (h) {
          if (!isObj(h)) return h;
          var c = {}; for (var k2 in h) if (Object.prototype.hasOwnProperty.call(h, k2)) c[k2] = h[k2];
          return c;
        });
      }
    }
    var srcHolders = holdersOf(cfg, rec);
    srcHolders.forEach(function (h, hi) {
      cfg.fields.forEach(function (f) {
        var v = h[f.data], urls = dataUrlsOf(v);
        if (!urls.length) return;
        var ok = urls.filter(function (u) { return isOk(formPhotoId(cfg.cat, code, u)); });
        if (ok.length !== urls.length) return;       // เอาเฉพาะกรณีเก็บครบทุกรูปของช่องนั้น
        ensureClone();
        var target = cfg.items ? holdersOf(cfg, out)[hi] : out;
        target[f.ids] = uniq((Array.isArray(h[f.ids]) ? h[f.ids] : []).concat(urls.map(function (u) { return formPhotoId(cfg.cat, code, u); })));
        target[f.data] = Array.isArray(v) ? v.filter(function (u) { return urls.indexOf(u) < 0; }) : '';
      });
    });
    return out;
  }

  /* ใช้ตอนกดบันทึกฟอร์ม: คืนเรคคอร์ดที่เอา base64 ออกแล้ว (รูปไปอยู่ที่เก็บรูปแทน) */
  function absorbRecord(key, rec) {
    var cfg = FIELD_MAP[key];
    if (!cfg || !rec) return Promise.resolve(rec);
    var code = String(rec[cfg.codeKey] || '').trim();
    if (!code) return Promise.resolve(rec);
    var jobs = pendingUrls(cfg, rec);
    if (!jobs.length) return Promise.resolve(rec);
    var chain = Promise.resolve();
    jobs.forEach(function (j) { chain = chain.then(function () { return ensureFormPhoto(cfg.cat, code, j.url, j.name); }); });
    return chain.then(function () { return applyAbsorb(cfg, rec, code, function () { return true; }) || rec; });
  }

  /* ย้ายรูปที่ฝังอยู่แล้วในข้อมูลเดิมของทั้งหมวด — เฟส 1 เก็บรูป (นอกคิว) เฟส 2 เคลียร์ช่องในเรคคอร์ด (ในคิวเขียน กันชนกับการบันทึกพร้อมกัน) */
  function absorbStore(key) {
    var cfg = FIELD_MAP[key], L = window.LTAXDB;
    if (!cfg || !L) return Promise.resolve({ records: 0, photos: 0 });
    var ok = {}, nPhotos = 0;
    return L.get(key).then(function (list) {
      var chain = Promise.resolve();
      list.forEach(function (rec) {
        var code = String((rec && rec[cfg.codeKey]) || '').trim();
        if (!code) return;
        pendingUrls(cfg, rec).forEach(function (j) {
          chain = chain.then(function () {
            var id = formPhotoId(cfg.cat, code, j.url);
            if (ok[id]) return null;
            return ensureFormPhoto(cfg.cat, code, j.url, j.name).then(function () { ok[id] = true; nPhotos++; })
              .catch(function (e) { console.warn('absorb skip', key, code, e && e.message); });
          });
        });
      });
      return chain;
    }).then(function () {
      if (!nPhotos) return { records: 0, photos: 0 };
      return L._serial(function () {
        return L.get(key).then(function (list) {
          var changed = 0;
          var next = list.map(function (rec) {
            var code = String((rec && rec[cfg.codeKey]) || '').trim();
            if (!code) return rec;
            var out = applyAbsorb(cfg, rec, code, function (id) { return !!ok[id]; });
            if (out) { changed++; return out; }
            return rec;
          });
          if (!changed) return { records: 0, photos: nPhotos };
          return L.set(key, next).then(function () { return { records: changed, photos: nPhotos }; });
        });
      });
    });
  }
  function absorbExisting() {
    var keys = Object.keys(FIELD_MAP), tot = { records: 0, photos: 0 };
    var chain = init();
    keys.forEach(function (k) {
      chain = chain.then(function () { return absorbStore(k); }).then(function (r) { tot.records += r.records; tot.photos += r.photos; });
    });
    return chain.then(function () { return tot; });
  }

  /* ---------- ย้ายรูปเดิมจาก ltax_photos_db (v1: base64 ใน record) ---------- */
  var migrating = false;
  function legacyOpen() {
    return new Promise(function (res) {
      if (!window.indexedDB) { res(null); return; }
      var rq;
      try { rq = indexedDB.open(LEGACY_DB); } catch (e) { res(null); return; }
      // ถ้ายังไม่เคยมีฐานนี้ ห้ามสร้างทิ้งไว้ → ยกเลิกการ upgrade
      rq.onupgradeneeded = function (e) { try { e.target.transaction.abort(); } catch (x) {} };
      rq.onsuccess = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('photos')) { db.close(); res(null); return; }
        res(db);
      };
      rq.onerror = function () { res(null); };
      rq.onblocked = function () { res(null); };
    });
  }
  function legacyKeys(db) {
    return new Promise(function (res) {
      var keys = [];
      var t = db.transaction('photos', 'readonly');
      var st = t.objectStore('photos');
      if (st.getAllKeys) {
        var r = st.getAllKeys();
        r.onsuccess = function () { res(r.result || []); };
        r.onerror = function () { res([]); };
      } else {
        var c = st.openCursor();
        c.onsuccess = function () {
          var cur = c.result;
          if (cur) { keys.push(cur.key); cur.continue(); } else res(keys);
        };
        c.onerror = function () { res(keys); };
      }
    });
  }
  function legacyGet(db, key) {
    return new Promise(function (res) {
      var r = db.transaction('photos', 'readonly').objectStore('photos').get(key);
      r.onsuccess = function () { res(r.result || null); };
      r.onerror = function () { res(null); };
    });
  }
  function legacyDelete(db, key) {
    return new Promise(function (res) {
      var t = db.transaction('photos', 'readwrite');
      t.objectStore('photos').delete(key);
      t.oncomplete = function () { res(true); };
      t.onerror = function () { res(false); };
      t.onabort = function () { res(false); };
    });
  }

  /* คืน { migrated, broken, left } — broken = เรคคอร์ดเดิมที่ไม่มีตัวรูปเหลือแล้ว (ลบทิ้งและนับไว้), left = ที่ย้าย/ลบไม่สำเร็จ (จะลองใหม่รอบหน้า) */
  function migrateLegacy(onProgress) {
    if (migrating) return Promise.resolve({ migrated: 0, broken: 0, left: 0, busy: true });
    migrating = true;
    api.migrating = true;
    var result = { migrated: 0, broken: 0, left: 0 };
    return init().then(legacyOpen).then(function (ldb) {
      if (!ldb) return result;
      return legacyKeys(ldb).then(function (keys) {
        var done = 0;
        function next(i) {
          if (i >= keys.length) return null;
          var key = keys[i];
          return legacyGet(ldb, key).then(function (rec) {
            if (!rec || typeof rec.dataUrl !== 'string' || rec.dataUrl.indexOf('data:') !== 0) {
              // เรคคอร์ดที่ไม่มีตัวรูปเหลือ (เกิดจากบั๊กเดิมตอน "ยกเลิกจับคู่" ที่เขียนทับทั้งเรคคอร์ด)
              // ไม่มีข้อมูลอะไรให้กู้คืนแล้ว (ts/GPS/รูปหายหมด) → ลบทิ้งและนับไว้แจ้งผู้ใช้
              return legacyDelete(ldb, key).then(function (ok) { if (ok) result.broken++; else result.left++; });
            }
            return getMeta(rec.id || String(key)).then(function (exists) {
              if (exists) return legacyDelete(ldb, key); // เขียนไปแล้วแต่ยังไม่ได้ลบ (เช่น แอปปิดกลางทาง)
              var blob = dataUrlToBlob(rec.dataUrl);
              return makeThumb(blob).then(function (thumb) {
                var meta = {
                  id: rec.id || String(key), category: rec.category || '', code: rec.code || '',
                  ts: rec.ts || Date.now(), lat: rec.lat == null ? null : rec.lat, lng: rec.lng == null ? null : rec.lng,
                  fileName: rec.fileName || '', status: 'new', seq: null, exportedAt: null,
                  raw: false, ext: /png/.test(blob.type) ? 'png' : 'jpg', thumb: thumb, bytes: blob.size, w: 0, h: 0, legacy: true
                };
                return putPhoto(meta, blob);
              }).then(function () { return legacyDelete(ldb, key); });
            }).then(function (ok) {
              if (ok) result.migrated++; else result.left++;
            });
          }).catch(function () { result.left++; }).then(function () {
            done++;
            if (onProgress && (done % 5 === 0 || done === keys.length)) onProgress(done, keys.length);
            return next(i + 1);
          });
        }
        // ทำทีละรูปต่อเนื่อง (next เรียกตัวเองต่อ) เพื่อคุมหน่วยความจำ
        return Promise.resolve(next(0));
      }).then(function () { try { ldb.close(); } catch (e) {} return result; });
    }).then(function (r) { migrating = false; api.migrating = false; return r; },
            function (e) { migrating = false; api.migrating = false; throw e; });
  }

  /* ---------- สร้างไฟล์ ZIP (ไม่บีบอัด — รูป JPEG บีบมาแล้ว) ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosDateTime(ms) {
    var d = new Date(ms || Date.now());
    var y = Math.max(1980, d.getFullYear());
    return {
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    };
  }
  function utf8(s) { return new TextEncoder().encode(s); }

  function ZipBuilder() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }
  ZipBuilder.prototype.add = function (name, data, size, crc, mtime) {
    var nameBytes = utf8(name);
    var dt = dosDateTime(mtime);
    var h = new Uint8Array(30 + nameBytes.length);
    var v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true);          // ชื่อไฟล์เป็น UTF-8
    v.setUint16(8, 0, true);               // method 0 = stored
    v.setUint16(10, dt.time, true);
    v.setUint16(12, dt.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);
    v.setUint32(22, size, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    h.set(nameBytes, 30);
    this.parts.push(h, data);

    var c = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dt.time, true);
    cv.setUint16(14, dt.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, this.offset, true);
    c.set(nameBytes, 46);
    this.central.push(c);

    this.offset += h.length + size;
    this.count++;
    if (this.count > 65000 || this.offset > 4000000000) throw new Error('ไฟล์ ZIP ใหญ่เกินกำหนด — ลดจำนวนรูปต่อชุด');
  };
  ZipBuilder.prototype.finish = function () {
    var cdSize = 0;
    this.central.forEach(function (c) { cdSize += c.length; });
    var e = new Uint8Array(22);
    var v = new DataView(e.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.count, true);
    v.setUint16(10, this.count, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, this.offset, true);
    return new Blob(this.parts.concat(this.central, [e]), { type: 'application/zip' });
  };

  /* SHA-256 แบบ JS ล้วน — ใช้สำรองเมื่อ crypto.subtle ไม่มี (เช่น เปิดผ่าน http:// ในวงแลน ที่ไม่ใช่ HTTPS)
     ทำให้ค่า sha256 ใน manifest ไม่ว่างเปล่าเงียบๆ */
  var SHA_K = null, SHA_H0 = null;
  function shaInit() {
    if (SHA_K) return;
    SHA_K = []; SHA_H0 = [];
    var isPrime = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
    for (var cand = 2, n = 0; n < 64; cand++) {
      if (!isPrime(cand)) continue;
      if (n < 8) SHA_H0[n] = frac(Math.pow(cand, 0.5));
      SHA_K[n] = frac(Math.pow(cand, 1 / 3));
      n++;
    }
  }
  function sha256js(u8) {
    shaInit();
    var len = u8.length, bitHi = Math.floor(len / 536870912), bitLo = (len << 3) >>> 0;
    var padLen = ((len + 9 + 63) >> 6) << 6;
    var m = new Uint8Array(padLen);
    m.set(u8);
    m[len] = 0x80;
    var dv = new DataView(m.buffer);
    dv.setUint32(padLen - 8, bitHi, false);
    dv.setUint32(padLen - 4, bitLo, false);
    var h = SHA_H0.slice(), w = new Int32Array(64), K = SHA_K;
    for (var off = 0; off < padLen; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4, false);
      for (i = 16; i < 64; i++) {
        var a15 = w[i - 15], a2 = w[i - 2];
        var s0 = ((a15 >>> 7) | (a15 << 25)) ^ ((a15 >>> 18) | (a15 << 14)) ^ (a15 >>> 3);
        var s1 = ((a2 >>> 17) | (a2 << 15)) ^ ((a2 >>> 19) | (a2 << 13)) ^ (a2 >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = '';
    for (var j = 0; j < 8; j++) out += ('00000000' + (h[j] >>> 0).toString(16)).slice(-8);
    return out;
  }
  function sha256hex(u8) {
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        return crypto.subtle.digest('SHA-256', u8).then(function (d) {
          var u = new Uint8Array(d), s = '';
          for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
          return s;
        }).catch(function () { return sha256js(u8); });
      }
    } catch (e) {}
    try { return Promise.resolve(sha256js(u8)); } catch (e2) { return Promise.resolve(''); }
  }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* entries: [{ name, text } | { name, blob } | { name, getBlob: fn→Promise<Blob>, sha:true }]
     opts: { onProgress(done,total), extraAfter(hashesByName) → entries เพิ่มท้ายไฟล์ (เช่น manifest ที่ต้องใช้ sha256) }
     อ่านรูปทีละไฟล์ (ไม่โหลดทั้งหมดเข้าหน่วยความจำพร้อมกัน) */
  function makeZip(entries, opts) {
    opts = opts || {};
    var zb = new ZipBuilder();
    var hashes = {};
    var total = entries.length, done = 0;

    function addEntry(e) {
      var p;
      if (e.text != null) {
        var u = utf8(e.text);
        p = Promise.resolve({ u8: u, data: u });
      } else {
        p = Promise.resolve(e.getBlob ? e.getBlob() : e.blob).then(function (b) {
          if (!b) throw new Error('ไม่พบข้อมูลรูป: ' + e.name);
          return readBuffer(b).then(function (buf) { return { u8: new Uint8Array(buf), data: b, buf: buf }; });
        });
      }
      return p.then(function (r) {
        zb.add(e.name, r.data, r.u8.length, crc32(r.u8), e.mtime);
        if (e.sha) return sha256hex(r.u8).then(function (h) { hashes[e.name] = h; });
      });
    }
    function addAll(list) {
      var i = 0;
      function step() {
        if (i >= list.length) return Promise.resolve();
        var e = list[i++];
        return addEntry(e).then(function () {
          done++;
          if (opts.onProgress) opts.onProgress(done, total);
          return tick();
        }).then(step);
      }
      return step();
    }
    return addAll(entries).then(function () {
      var extra = opts.extraAfter ? opts.extraAfter(hashes) : [];
      total += extra.length;
      return addAll(extra);
    }).then(function () {
      return { blob: zb.finish(), hashes: hashes, count: zb.count };
    });
  }

  /* ---------- ชื่อไฟล์ตอนส่งออก ---------- */
  function safeName(s) { return String(s).replace(/[^A-Za-z0-9._\-\u0E00-\u0E7F]/g, '_'); }
  function parcelOf(code) { return String(code).split('-')[0]; }
  function fileName(m) {
    var n = m.seq < 10 ? '0' + m.seq : String(m.seq);
    return 'photos/' + safeName(parcelOf(m.code)) + '/' + safeName(m.code) + '_' + n + '.' + (m.ext || 'jpg');
  }

  function deviceId() {
    var id = null;
    try { id = localStorage.getItem('ltax_device_id'); } catch (e) {}
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem('ltax_device_id', id); } catch (e) {}
    }
    return id;
  }

  var api = {
    init: init, persist: persist, storage: storage, persisted: false, migrating: false,
    listMeta: listMeta, getMeta: getMeta, getBlob: getBlob, putPhoto: putPhoto,
    addPhoto: addPhoto, updateMeta: updateMeta, updateMany: updateMany,
    remove: remove, clearAll: clearAll, markExported: markExported,
    assignSeq: assignSeq, stats: stats, migrateLegacy: migrateLegacy,
    FIELD_MAP: FIELD_MAP, holdersOf: holdersOf, uniq: uniq, dataUrlsOf: dataUrlsOf, absorbRecord: absorbRecord, absorbStore: absorbStore, absorbExisting: absorbExisting,
    makeZip: makeZip, crc32: crc32, sha256js: sha256js, fileName: fileName, parcelOf: parcelOf, safeName: safeName,
    dataUrlToBlob: dataUrlToBlob, blobToDataUrl: blobToDataUrl, deviceId: deviceId,
    LEGACY_DB: LEGACY_DB, DB_NAME: DB_NAME
  };
  window.PhotoStore = api;
})();
