/* LTAX Offline — Service Worker
   cache-first: ครั้งแรกต้องมีเน็ตเพื่อติดตั้ง ครั้งต่อ ๆ ไปเปิดได้แม้ไม่มีเน็ต
   version: 20260822-033249
*/
var VERSION = "20260822-033249";
var CACHE = "ltax-offline-" + VERSION;

var ASSETS = [
  "index.html",
  "manifest.json",
  "admin_data.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "ฟอร์ม_เพิ่มเจ้าของทรัพย์สิน.html",
  "ฟอร์ม_เพิ่มที่ดิน.html",
  "ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html",
  "ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html",
  "ฟอร์ม_เพิ่มการใช้ประโยชน์สิ่งปลูกสร้าง.html",
  "ฟอร์ม_เพิ่มป้าย.html",
  "ฟอร์ม_ทะเบียนทรัพย์สิน.html",
  "ถ่ายรูป.html"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS).then(function () { return self.skipWaiting(); });
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE && k.indexOf("ltax-offline-") === 0; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // เส้นทาง API (ส่งข้อมูลไปคอมฯ) ให้ไปที่ server โดยตรง — ไม่ cache
  if (url.pathname.indexOf("/api/") === 0) return;

  // หน้าเว็บ (navigate): ใช้จาก cache ทันที + อัปเดตเบื้องหลังเมื่อมีเน็ต
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("index.html").then(function (hit) {
        var update = fetch(req).then(function (res) {
          if (res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put("index.html", copy); });
          }
          return res;
        }).catch(function () { return null; });
        return hit || update;
      })
    );
    return;
  }

  // ไฟล์อื่น: cache-first แล้วค่อยเช็คเน็ตเบื้องหลัง
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
