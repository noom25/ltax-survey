# -*- coding: utf-8 -*-
"""build_pwa.py — รวมไฟล์ฟอร์ม (web/*.html) ไปเป็น web/index.html ตัวเดียว (SPA/PWA)
+ สร้าง manifest.json, sw.js และไอคอน (icons/*.png) ให้ติดตั้งเป็นแอปบนหน้าจอได้

วิธีใช้:
    python build_pwa.py            # build ทั้งหมดลง web/
    python build_pwa.py --sync     # + คัดลอก index.html ไป mobile_offline/ (สำหรับแอป Documents)

หลักการ:
- แก้ไฟล์ฟอร์มแยก (web/ฟอร์ม_*.html, web/ถ่ายรูป.html) ได้ตามปกติ
- รัน build ใหม่ทุกครั้ง → index.html ที่รวมทุกฟอร์มถูกสร้างใหม่
- บั๊กที่เคยเจอ (</script> หลุด escape) แก้ตรงนี้: สคริปต์ฟอร์มถูกแยกเก็บ
  และ Escape `</script>` -> `<\\/script>` ให้เรียบร้อยก่อนฝังลงหน้าเดียว
"""
import os
import re
import sys
import json
import time
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# โครงสร้างปัจจุบัน: ไฟล์อยู่ที่ root ตรง ๆ (ไม่แยก web\) — Pages/server ใช้ root
WEB_DIR = BASE_DIR

# ลำดับ + id ของฟอร์ม (id ใช้กับ localStorage และ openForm)
FORM_ORDER = [
    ("ฟอร์ม_เพิ่มเจ้าของทรัพย์สิน.html", "ltax_owner"),
    ("ฟอร์ม_เพิ่มที่ดิน.html", "ltax_land"),
    ("ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html", "ltax_land_usage"),
    ("ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html", "ltax_building"),
    ("ฟอร์ม_เพิ่มการใช้ประโยชน์สิ่งปลูกสร้าง.html", "ltax_building_usage"),
    ("ฟอร์ม_เพิ่มป้าย.html", "ltax_sign"),
    ("ฟอร์ม_ทะเบียนทรัพย์สิน.html", "ltax_asset"),
    ("ถ่ายรูป.html", "ltax_photo"),
]

BUILD_TS = time.strftime("%Y%m%d-%H%M%S")


def read(name):
    path = os.path.join(WEB_DIR, name)
    with open(path, "r", encoding="utf-8-sig") as f:
        return f.read()


def extract_style(html):
    m = re.search(r"<style[^>]*>(.*?)</style>", html, re.S)
    return m.group(1).strip() if m else ""


def extract_body(html):
    m = re.search(r"<body[^>]*>(.*)</body>", html, re.S)
    return m.group(1) if m else html


def extract_scripts(html):
    return re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)


def strip_scripts(html):
    return re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.S)


def esc_html(s):
    """Escape เนื้อหา HTML ที่จะฝังใน <template>"""
    return (s.replace("</template>", "<\\/template>")
             .replace("</script>", "<\\/script>")
             .replace("<!--", "<\\!--"))


def esc_js(s):
    """Escape สคริปต์ที่จะฝังใน <script type="text/plain"> / <script>"""
    return s.replace("</script>", "<\\/script>").replace("<!--", "<\\!--")


def build_index():
    home = read("home.html")
    home_css = extract_style(home)
    home_body = extract_body(home)
    home_js = esc_js("\n\n".join(extract_scripts(home)))

    tpl_parts = []
    js_parts = []
    for fname, fid in FORM_ORDER:
        path = os.path.join(WEB_DIR, fname)
        if not os.path.exists(path):
            print("  [คำเตือน] ไม่พบ %s (ข้าม)" % fname)
            continue
        html = read(fname)
        css = extract_style(html)
        body = esc_html(strip_scripts(extract_body(html)))
        js = esc_js("\n\n".join(extract_scripts(html)))
        tpl_parts.append(
            '<template id="tpl-%s">\n<style>\n%s\n</style>\n%s\n</template>' % (fid, css, body)
        )
        js_parts.append('<script type="text/plain" id="js-%s">\n%s\n</script>' % (fid, js))

    parts = [
        '<!DOCTYPE html>',
        '<html lang="th">',
        '<head>',
        '<meta charset="UTF-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        '<title>LTAX Offline — ระบบสำรวจภาษีที่ดินและสิ่งปลูกสร้าง</title>',
        '<link rel="manifest" href="manifest.json">',
        '<meta name="theme-color" content="#1b4f8a">',
        '<meta name="mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        '<meta name="apple-mobile-web-app-title" content="LTAX">',
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
        '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">',
        '<link rel="icon" type="image/png" sizes="512x512" href="icons/icon-512.png">',
        '<style>',
        '/* ===== หน้าแรก (จาก home.html) ===== */',
        home_css,
        '</style>',
        '<script src="admin_data.js"></script>',
        '<script src="db.js"></script>',
        '<script src="db_helpers.js"></script>',
        '</head>',
        '<body>',
        '<div id="view-home">',
        home_body,
        '</div>',
        '<div id="view-form" style="display:none;"></div>',
        '',
        '<!-- เทมเพลตฟอร์ม — เปิดผ่าน router (openForm) -->',
        "\n\n".join(tpl_parts),
        '',
        '<!-- สคริปต์ของฟอร์ม — แยกเก็บ ไม่รันตอนโหลด (รันเมื่อเปิดฟอร์ม) -->',
        "\n\n".join(js_parts),
        '',
        '<script>',
        '/* ===== สคริปต์หน้าแรก + router + PWA (จาก home.html) ===== */',
        home_js,
        '</script>',
        '</body>',
        '</html>',
    ]
    index = "\n".join(parts)

    out = os.path.join(WEB_DIR, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(index)

    n_tpl = index.count('<template id="tpl-')
    n_js = index.count('<script type="text/plain" id="js-')
    print("  index.html: %d bytes (%d ฟอร์มฝัง)" % (len(index), n_tpl))
    if n_tpl != len(FORM_ORDER) or n_js != len(FORM_ORDER):
        print("  [คำเตือน] จำนวนเทมเพลตไม่ตรง (%d/%d)" % (n_tpl, len(FORM_ORDER)))
    return out


def build_manifest():
    manifest = {
        "name": "LTAX Offline — สำรวจภาษีที่ดินและสิ่งปลูกสร้าง",
        "short_name": "LTAX",
        "description": "ระบบสำรวจภาษีที่ดินและสิ่งปลูกสร้าง (อบต.ปรือใหญ่ จ.ศรีสะเกษ) — เก็บข้อมูลและรูปออฟไลน์",
        "lang": "th",
        "start_url": "index.html",
        "scope": "./",
        "display": "standalone",
        "orientation": "portrait",
        "background_color": "#153d6b",
        "theme_color": "#1b4f8a",
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        ],
    }
    out = os.path.join(WEB_DIR, "manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("  manifest.json เขียนแล้ว")


def build_sw():
    assets = ['index.html', 'manifest.json', 'admin_data.js', 'db.js', 'db_helpers.js',
              'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']
    assets += [fname for fname, _ in FORM_ORDER]

    sw_src = SW_TEMPLATE.replace("__VERSION__", BUILD_TS)
    sw_src = sw_src.replace("__ASSETS__", json.dumps(assets, ensure_ascii=False, indent=2))

    out = os.path.join(WEB_DIR, "sw.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(sw_src)
    print("  sw.js เขียนแล้ว (version %s, cache %d ไฟล์)" % (BUILD_TS, len(assets)))


def make_icons(icons_dir):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        print("  [ข้าม] ไม่มี Pillow — ข้ามสร้างไอคอน (แอปรันได้ แต่ไอคอนหาย)")
        return False
    os.makedirs(icons_dir, exist_ok=True)
    top = (27, 79, 138)
    bottom = (21, 61, 107)
    door = (31, 78, 121)
    for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        img = Image.new("RGB", (size, size), bottom)
        px = img.load()
        for y in range(size):
            t = y / (size - 1)
            r = int(top[0] + (bottom[0] - top[0]) * t)
            g = int(top[1] + (bottom[1] - top[1]) * t)
            b = int(top[2] + (bottom[2] - top[2]) * t)
            for x in range(size):
                px[x, y] = (r, g, b)
        d = ImageDraw.Draw(img)
        w = size * 0.52
        x0 = (size - w) / 2
        d.polygon([(size / 2, size * 0.10), (x0, size * 0.40), (x0 + w, size * 0.40)], fill=(255, 255, 255))
        d.rectangle([x0, size * 0.40, x0 + w, size * 0.74], fill=(255, 255, 255))
        d.rectangle([size / 2 - w * 0.13, size * 0.50, size / 2 + w * 0.13, size * 0.74], fill=door)
        try:
            font = ImageFont.load_default(size=int(size * 0.12))
        except TypeError:
            font = ImageFont.load_default()
        txt = "LTAX"
        tb = d.textbbox((0, 0), txt, font=font)
        tw = tb[2] - tb[0]
        d.text((size / 2 - tw / 2, size * 0.80), txt, font=font, fill=(255, 255, 255))
        img.save(os.path.join(icons_dir, name))
    print("  ไอคอนสร้างแล้ว: icons/icon-512.png, icon-192.png, apple-touch-icon.png")
    return True


def main():
    sync = "--sync" in sys.argv
    print("build_pwa.py — รวมฟอร์มเป็น PWA ตัวเดียว")
    print("  web/:", WEB_DIR)
    build_index()
    build_manifest()
    build_sw()
    make_icons(os.path.join(WEB_DIR, "icons"))

    if sync:
        dst = os.path.join(BASE_DIR, "mobile_offline", "index.html")
        shutil.copyfile(os.path.join(WEB_DIR, "index.html"), dst)
        print("  --sync: คัดลอก index.html -> mobile_offline/index.html แล้ว")
    print("เสร็จ — ไฟล์เว็บอยู่ที่ root (index.html, sw.js, manifest.json, icons/) พร้อมอัปขึ้นเว็บจริง (https)")


SW_TEMPLATE = """/* LTAX Offline — Service Worker
   cache-first: ครั้งแรกต้องมีเน็ตเพื่อติดตั้ง ครั้งต่อ ๆ ไปเปิดได้แม้ไม่มีเน็ต
   version: __VERSION__
*/
var VERSION = "__VERSION__";
var CACHE = "ltax-offline-" + VERSION;

var ASSETS = __ASSETS__;

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
"""


if __name__ == "__main__":
    main()
