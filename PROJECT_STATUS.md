# สถานะโครงการ LTAX Offline — สรุปสำหรับเซสชันถัดไป

> ไฟล์นี้ใช้ให้ AI (opencode) อ่านเพื่อต่อบทสนทนาได้ทันที อัปเดตเมื่อมีงานใหม่เสร็จ

## โครงการคืออะไร
ระบบสำรวจข้อมูลภาษีที่ดินและสิ่งปลูกสร้าง (LTAX) แบบออฟไลน์:
**มือถือ (iPhone/iPad/Android) → ฟอร์มกรอก + ถ่ายรูป → ส่งกลับคอมฯ → แปลง Excel + แยกรูป → บอทอัปเข้า LTAX Online (lsso.dla.go.th)**

## โฟลเดอร์หลัก
- `C:\LTAX_Automation\bot_upload_data v1\` — ระบบ v1 (สำรวจภาคสนาม) ← **งานหลักที่ทำล่าสุด**
- `C:\LTAX_Automation\bot_upload_data v2\` — ข้อมูลมาตรา 10 / โฉนด / นส.3ก จากกรมที่ดิน (แปลงเดียว 1 เอกสาร)
- `C:\LTAX_Automation\bot_upload_data v3\` — v2 ที่รวมฟังก์ชันทั้งหมด + ตรวจ/อัปเดตข้อมูลเดิม
- `C:\LTAX_Automation\` — มีโปรเจกต์ bot อื่นอีกมาก (พิมพ์ 4.0-6.8, pds6/7, alro, etc.)

## โครงสร้าง v1
```
bot_upload_data v1\
├── build_pwa.py                ← ★ ใหม่: รวมฟอร์ม → index.html + manifest + sw.js + ไอคอน (รันทุกครั้งหลังแก้ฟอร์ม)
├── web\                        ← โฟลเดอร์ที่ deploy/อัปโหลด (PWA ทั้งแอปอยู่ในนี้)
│   ├── home.html               ← ★ ใหม่: ต้นฉบับหน้าแรก (SPA + router + ค้นหา/แก้ไข/ลบ + รวมข้อมูล + ปุ่มถ่ายรูป + แผงติดตั้ง)
│   ├── ถ่ายรูป.html             ← ★ ใหม่: หน้าถ่ายรูปชุด + คลังรอจับคู่ + จับคู่รหัสเป็นกลุ่ม
│   ├── index.html              ← ★ สร้างโดย build_pwa.py (ห้ามแก้ตรง — แก้ที่ home.html/ฟอร์มแล้ว build)
│   ├── manifest.json           ← ★ สร้างโดย build_pwa.py (ชื่อแอป/ไอคอน สำหรับ "เพิ่มไปหน้าจอโฮม")
│   ├── sw.js                   ← ★ สร้างโดย build_pwa.py (service worker — cache ทั้งแอป ใช้ได้ออฟไลน์ 100%)
│   ├── icons\                  ← ★ สร้างโดย build_pwa.py (icon-192/512/apple-touch-icon)
│   ├── ฟอร์ม_เพิ่มเจ้าของทรัพย์สิน.html         ← ต้นฉบับฟอร์ม (แก้ที่นี่แล้ว build)
│   ├── ฟอร์ม_เพิ่มที่ดิน.html
│   ├── ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html
│   ├── ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html
│   ├── ฟอร์ม_เพิ่มการใช้ประโยชน์สิ่งปลูกสร้าง.html
│   ├── ฟอร์ม_เพิ่มป้าย.html
│   ├── server.py                ← web server กลาง (serve web\ + /api/upload → json_to_excel.py)
│   └── start_server.bat
├── server.py / start_server.bat  ← สำเนาไว้อัปโหลด (ยังใช้ตัวเดิมได้)
├── json_to_excel.py             ← แปลง ltax_data_all.json → Excel 6 ชีต + แยกรูป HEIC→JPG
├── run_all.py + bot_add_*.py    ← บอทอัป LTAX Online
├── otp_manager_v2.py / config.json / field_mapping_complete.json
├── photos\ / ltax_data_all.json / owner_land_building_template.xlsx
├── mobile_offline\              ← ฟอร์มชุดพกสนาม (Documents Readdle) — รัน build_pwa.py --sync เพื่ออัป index.html
├── คู่มือการใช้งาน.md
└── sample_data\
```

## งานที่ทำรอบล่าสุด (PWA + ถ่ายรูปชุด) — เสร็จแล้ว
- [x] **PWA ติดตั้งเป็นแอป (manifest + service worker + ไอคอน)** — กด "เพิ่มไปที่หน้าจอโฮม" ได้ทั้ง iOS/Android
      เปิดครั้งแรกต้องมีเน็ต 1 ครั้ง หลังจากนั้นเปิดออฟไลน์ 100% (ข้อมูลอยู่ในเครื่อง localStorage/IndexedDB ไม่ส่งเน็ต)
- [x] **index.html เป็นหน้าเดียว (SPA)** — รวม 6 ฟอร์ม + หน้าถ่ายรูป ด้วย `build_pwa.py`
      แก้บั๊ก `</script>` หลุด escape (แยกสคริปต์ฟอร์มเก็บใน `<script type="text/plain">` + Escape `</script>`→`<\\/script>`)
      แก้ฟอร์มแยก → รัน `python build_pwa.py` → ได้ index.html ใหม่ (มี --sync คัดลอกไป mobile_offline ด้วย)
- [x] **ฟอร์มทั้ง 6 รองรับ SPA** — อ่าน `window.__editQuery` (โหมดรวมหน้า) + `goBack()` เรียก `__goHome()` ถ้ามี (โหมดแยกยังใช้ได้)
- [x] **หน้าถ่ายรูป / จัดการรูปภาพ** (ถ่ายรูป.html):
      · เลือกหมวด (ที่ดิน/อาคาร/ป้าย) + รหัสจากรายการที่กรอกแล้ว (กรองพิมพ์ค้นได้) ก่อนถ่าย — กันจับคู่ผิด
      · **จำรหัสล่าสุด** ของแต่ละหมวด (localStorage) — ถ่ายแปลงเดียวกันหลายรูปไม่ต้องเลือกใหม่
      · ปุ่ม "ถ่ายด่วน" — ถ้ายังไม่ได้เลือก ได้ไปอยู่ใน **คลังรอจับคู่**
      · **คลังรอจับคู่**: เลือกหลายรูป (multi-select / เลือกทั้งกลุ่ม) → กด "จับคู่กับ..." → เลือกรหัสเดียว จบทั้งชุด
      · **จัดกลุ่มอัตโนมัติ** ตามเวลาถ่าย (ห่าง > 2 นาที = กลุ่มใหม่) + GPS (ห่าง > 100 ม. = กลุ่มใหม่ ถ้าเปิดตำแหน่ง)
      · รูปเก็บใน **IndexedDB** (รองรับเป็นร้อยรูป ไม่กิน localStorage 5MB — fallback เป็น localStorage ในเว็บวิวเก่า)
      · ปุ่มย้ายกลับ/ลบรูป/ลบทั้งหมด
- [x] **รวมข้อมูลแนบรูปอัตโนมัติ** — กด "รวมข้อมูล (JSON)"/"สร้างไฟล์ Excel"/"ส่งข้อมูลไปคอมฯ"
      จะดึงรูปจากหน้าถ่ายรูปมาแนบให้แปลง/อาคาร/ป้าย (รหัสตรงกัน) → json_to_excel.py แยกรูปให้เอง (รูปภาพ_data/รูปที่ดิน_data)
- [x] **ทดสอบ Selenium ผ่านครบ (22/22 ตรวจ)**: เปิดฟอร์มทั้ง 7 (สคริปต์รัน + จ. เติมครบ) / แก้ไขผ่านค้นหา / บันทึกทับ /
      goBack แบบไม่ reload / ค้นหา / เก็บรูป IDB / จับคู่กลุ่ม / รวมข้อมูลแนบรูป / ไม่มี JS error
- [x] **ทดสอบผ่าน HTTP (localhost:8001)**: server serve index.html + manifest.json + sw.js + icons ครบ /
      SW register + controller หลัง reload / cache `ltax-offline-*` ถูกสร้างครอบคลุมฟอร์มทั้ง 6 + หน้าถ่ายรูป
- [x] **ทดสอบออฟไลน์จริง**: เปิดหน้า → SW ทำงาน → **ปิด server** → refresh แล้วหน้าหลัก/ฟอร์ม/หน้าถ่ายรูปยังเปิดได้จาก cache ครบ

## โฟลว์การทำงาน (สำคัญ)
1. คอมฯ ดับเบิลคลิก `start_server.bat` → ขึ้น URL เช่น `http://192.168.x.x:8000`
2. มือถือต่อ WiFi เดียวกัน เปิด URL → ทำงานตามลำดับ: **ถ่ายรูป** (เลือกหมวด+รหัส หรือถ่ายด่วนไปก่อน) → กรอก 6 ฟอร์ม
3. กด "ส่งข้อมูลไปคอมฯ" → server รับ JSON → สร้าง Excel + แยกรูปอัตโนมัติ
4. คอมฯ รัน: `python run_all.py --excel owner_land_building_template.xlsx` → บอทอัป LTAX Online

**โหมดแอป (PWA):** อัปโหลดโฟลเดอร์ `web\` ขึ้นเว็บ https (เช่น GitHub Pages หรือ server ในหน่วยงาน) → เปิดครั้งแรก →
จัดการ "เพิ่มไปที่หน้าจอโฮม" (iOS: ปุ่ม Share → เพิ่มไปหน้าจอโฮม / Android: ⋮ → เพิ่มไปหน้าจอหลัก) → ใช้ได้ออฟไลน์ 100%

**โหมดพกสนาม (Documents Readdle):** ใช้ `mobile_offline\` (รัน `python build_pwa.py --sync` หลัง build เพื่อได้ index.html ใหม่)

## GitHub Pages (deploy ขึ้นเว็บจริง) — เสร็จแล้ว
- [x] **URL: `https://noom25.github.io/ltax-survey/`** — เปิดบน iPhone/Android ได้ทันที (ต้องมีเน็ตครั้งแรก 1 ครั้ง)
- [x] ติดตั้งเป็นแอป: Safari → Share → "เพิ่มไปที่หน้าจอโฮม" → เปิดจากหน้าจอโฮม ใช้ได้ออฟไลน์ 100%
- [x] Repo: `noom25/ltax-survey` (public) — โฟลเดอร์ mirror อยู่ที่ `C:\LTAX_Automation\ltax-survey\` (git repo พร้อม remote origin)
- [x] GitHub Pages เปิด: Deploy from branch `main`, path `/` (test ผ่าน: หน้าโหลด / SW+controller / cache / ฟอร์มทั้ง 7 / validation บน https)
- [x] ทดสอบ Selenium ผ่าน URL จริง: เปิดฟอร์มทั้ง 7 + SW ลงทะเบียน + cache `ltax-offline-*` ถูกสร้าง + ตรวจ required fields ได้
- **วิธีอัปเดตเว็บ** (หลังแก้ฟอร์ม/home/ถ่ายรูป แล้วรัน build):
  1. `python build_pwa.py` → ได้ `web\index.html` ใหม่
  2. copy ไฟล์ทั้งหมดใน `web\` (ยกเว้น server.py/start_server.bat) ไปทับที่ `C:\LTAX_Automation\ltax-survey\`
  3. เปิด PowerShell ที่โฟลเดอร์นั้น: `git add -A` → `git commit -m "update"` → `git push origin main`
  4. รอ ~1 นาที แล้วเปิด URL ใหม่ (SW จะโหลดเวอร์ชันใหม่ให้อัตโนมัติ)
- **ข้อจำกัดบน GitHub Pages:** ไม่มี server → ปุ่ม "ส่งข้อมูลไปคอมฯ" ใช้ไม่ได้ (ต้องเปิดผ่าน LAN server) —
  ส่งข้อมูลกลับคอมฯ โดย: กด "รวมข้อมูล (JSON)" → ดาวน์โหลดไฟล์ `ltax_data_all.json` → แชร์ AirDrop/Line/เมล → คอมฯ รัน `python json_to_excel.py`
- **เพิ่มเติม:** ถ้าต้องการ repo ส่วนตัว (ไม่สาธารณะ) → เปลี่ยน Settings → Danger Zone → Make private (ต้องสมัครจ่าย GitHub Pro)

## คำเตือน/ข้อควรจำ
- **มือถือต้องเปิดผ่าน http:// เท่านั้น** — file:// บล็อก localStorage (ข้อมูลหาย) โดยเฉพาะ iOS Safari
  (ข้อยกเว้น: โหมด Documents Readdle ใช้ file:// ได้เพราะเป็นฟอร์มชุดพก)
- **มี server เก่าค้างที่พอร์ต 8000** (PID 16408, access denied ฆ่าไม่ได้ — น่าจะเป็น server เก่าจาก mobile_offline)
  → ก่อนเปิด `start_server.bat` ถ้า port ไม่ว่าง ต้องจัดการ process นั้นก่อน
- `run_all.py` default excel เป็น `owner_land_building_template_v2.xlsx` → **ต้องระบุ `--excel owner_land_building_template.xlsx` เสมอ**
- **ห้ามแก้ `web/index.html` ตรง** — มันถูกสร้างโดย `build_pwa.py` (แก้ที่ `home.html` / `ฟอร์ม_*.html` / `ถ่ายรูป.html` แล้วรัน build)
- หลังแก้ฟอร์ม/หน้าแรก ต้องรัน `python build_pwa.py` ใหม่ แล้ว deploy `web\` ขึ้นเว็บอีกครั้ง (SW version จะเปลี่ยนเองอัตโนมัติ)
- localStorage เต็ม (~5MB) ถ้ารูปเยอะ → รูปของหน้าถ่ายรูปเก็บใน IndexedDB (ไม่กิน localStorage) แต่รูปที่ฝังในฟอร์มยังกิน — ลดขนาดรูป / ส่งข้อมูลบ่อย ๆ
- รูปต่อแปลง: LTAX Online รับ **1 รูป/แปลง** — ฟอร์มรับ 1 รูป ตรงตามระบบ (หน้าถ่ายรูปใช้ถ่ายเพื่อเก็บหลักฐาน/ส่งรวมเป็นชุดได้)
- การอัปใหม่ทั้งชุด (ครั้ง 2+): ต้องลบ `*_done.txt` (owner_done.txt, land_done.txt, ...)
- ข้อมูลใหม่เขียนทับไฟล์ล่าสุดทุกครั้งที่ส่ง (มือถือเป็น master, คอมฯเป็นสำเนา)

## สถานะงาน (ล่าสุด)
- [x] ระบบ v1 ครบ: web forms + server + ส่งข้อมูลจากมือถือ + แปลง Excel/รูป + ทดสอบผ่าน (Selenium)
- [x] ฟีเจอร์ค้นหา/ดู/แก้ไข/ลบข้อมูลบนหน้าแรก
- [x] ฟอร์มแก้ไขโหลดข้อมูลกลับ + บันทึกทับไม่ซ้ำ (test_save_over ผ่าน)
- [x] **PWA เต็มรูปแบบ: manifest + sw.js + ไอคอน + ติดตั้งเป็นแอป (ออฟไลน์ 100%)**
- [x] **SPA หน้าเดียว: build_pwa.py รวม 6 ฟอร์ม + หน้าถ่ายรูป แก้บั๊ก `</script>` escape**
- [x] **หน้าถ่ายรูปชุด: เลือกหมวด+รหัสก่อนถ่าย / จำรหัสล่าสุด / คลังรอจับคู่ / จับคู่หลายรูปทีเดียว / จัดกลุ่มเวลา+GPS / IndexedDB**
- [x] **รวมข้อมูลแนบรูปจากหน้าถ่ายรูปให้แปลง/อาคาร/ป้ายอัตโนมัติ**
- [x] **ทดสอบ Selenium ผ่านครบ + ทดสอบ HTTP/SW + ทดสอบออฟไลน์จริง (ปิด server แล้วใช้ได้จาก cache)**
- [x] **Deploy ขึ้น GitHub Pages แล้ว: https://noom25.github.io/ltax-survey/ (repo ltax-survey) + ทดสอบผ่าน URL จริง**
- [x] **ลบดาวน์โหลด JSON รายแปลงออกจากปุ่มบันทึกฟอร์ม (6 ฟอร์ม)**: บันทึกเก็บ localStorage อย่างเดียว ไม่สร้างไฟล์หลุด —
      เหลือไฟล์ที่ได้จากมือถือแค่ไฟล์เดียว ("รวมข้อมูล (JSON)") → deploy ขึ้น GitHub แล้ว (ตรวจ 0 call, sw version ใหม่, test Selenium ผ่าน)
- [x] **หน้าดูข้อมูล (viewData) แบบ AST001 + ปุ่มแก้ไขแยก**: ผลค้นหาแยกเป็น 2 ปุ่ม "ดูข้อมูล"/"แก้ไข" —
      กด ดูข้อมูล ได้หน้าอ่านอย่างเดียว: เจ้าของ (ข้อมูล + ตารางที่ดิน/อาคาร/ป้ายที่ผูกด้วยเลขบัตร) /
      ที่ดิน (เจ้าของ + อาคารบนแปลง + การใช้ประโยชน์) / อาคาร (เจ้าของ + การใช้) / ป้าย (เจ้าของ) —
      คลิก "ดู" ต่อในตารางได้ + ปุ่มกลับผลการค้นหา (home.html + build_pwa.py fallback web\ → root) — test Selenium ผ่านครบ
- [x] mobile_offline + zip สำหรับแอป Documents (ยังเป็นเวอร์ชันเก่า — รัน build_pwa.py --sync เพื่ออัป)
- [x] คู่มือการใช้งาน.md ฉบับสมบูรณ์ (ยังไม่ได้เพิ่มหัวข้อ PWA/ถ่ายรูปชุด)
- [ ] **ยังไม่ได้ลองใช้งานจริงบนมือถือ** (ผู้ใช้จะลอง iPhone เปิด https://noom25.github.io/ltax-survey/ + ติดตั้งเป็นแอป)
- [ ] ยังไม่ได้รันบอทอัปจริงกับ LTAX Online (ต้อง login+OTP ผู้ใช้อยู่หน้าจอ)
- [ ] ยังไม่ได้อัปเดต คู่มือการใช้งาน.md ให้ครอบคลุม PWA + หน้าถ่ายรูป

## สภาพแวดล้อมทดสอบ
- Windows, Python 3.11.6, PIL 12.3.0, openpyxl OK, selenium + webdriver_manager OK
- Chrome 151.0.7922.108 — ต้องใช้ `ChromeDriverManager().install()` (chromedriver เก่า v142 ใช้ไม่ได้)
- สคริปต์ทดสอบ Selenium อยู่ใน `C:\Users\NOOM\AppData\Local\Temp\opencode\ltax_sample\`
  (test_pwa_smoke.py / test_all_forms.py / test_sw.py / test_offline2.py / check_build.py / check_escape.py)
- **หมายเหตุ:** เครื่องนี้มี server เก่าค้างที่พอร์ต 8000 (PID 16408) ฆ่าไม่ได้ (access denied) — ทดสอบ PWA ใช้พอร์ต 8001 แทน
