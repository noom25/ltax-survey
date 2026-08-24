# สรุปงาน — Fix Flow "ที่ดินให้สิ่งปลูกสร้าง" (กันบ้านลอย) + เทียบฟอร์ม LTAX กรม

> วันที่: 2026-08-21 / โฟลเดอร์: `C:\LTAX_Automation\ltax-survey`
> สถานะ: ✅ เสร็จ + ทดสอบผ่าน + deploy แล้ว (commit `6dfa4afb85`)

---

## 1. ปัญหาที่พบ (จากข้อมูลทดสอบเครื่องอื่น `ltax_data_all.json`)

ชุดทดสอบเดิม **บ้านลอย** — อาคาร `01A01-B001` ไม่ผูกกับที่ดิน ไม่สมจริง:

| จุด | ข้อมูลทดสอบเดิม | ปัญหา |
|---|---|---|
| อาคาร `เนื้อที่ที่ดิน` | ว่าง `""` | บันทึกได้ ฟอร์มไม่บังคับ (บ้านลอย) |
| การใช้ที่ดิน | ใช้เต็มแปลง 10-0-0 (เกษตร) | มีอาคารตั้ง 90 ตร.ม. แต่ไม่มีการแบ่งที่ตั้งสิ่งปลูกสร้าง |
| `พื้นที่แปลงคงเหลือ (ตร.ว.)` | ว่าง | ไม่คำนวณ/เก็บให้ถูก |
| รูปภาพ | ทุกหมวดว่าง (0 รูป) | เก็บไว้ก่อน ยังไม่เน้นตอนนี้ |

**หลักการที่ควรเป็น (ตัวอย่างพี่: นาย ก ที่ดิน 10 ไร่ ทำนา 9 ไร่ ปลูกบ้าน 1 ไร่):**

```
เจ้าของ → ที่ดิน (4,000 ตร.วา)
→ ใช้ที่ดิน แยก 2 รายการ:
   ├─ เกษตร 9-0-0 (3,600 ตร.วา)
   └─ ที่ตั้งสิ่งปลูกสร้าง 1-0-0 (400 ตร.วา)   ← ตรงนี้ที่ขาด
→ อาคาร เนื้อที่ที่ดิน = 1-0-0
→ ใช้อาคาร → ป้าย (ถ้ามี)
```

---

## 2. สิ่งที่แก้ไปแล้ว — 5 จุด (ตามแผนที่วาง)

| # | จุด | ไฟล์ต้นฉบับ | คำอธิบาย |
|---|---|---|---|
| 1 | **REQUIRED บังคับเนื้อที่ที่ดินอาคาร** | `ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html` | เพิ่ม `landAreaStr` ใน `REQUIRED` → บันทึกไม่ได้ถ้าไม่กรอก (กันบ้านลอย) |
| 2 | **แก้บั๊ก key พื้นที่แปลงคงเหลือ** | `ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html` | `loadEditRecord()` อ่าน `(ตร.วา)` → เปลี่ยนเป็น `(ตร.ว.)` + fallback รองรับข้อมูลเก่า |
| 3 | **auto-fill เนื้อที่ที่ดินจากแปลง** | `ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html` | ฟังก์ชัน `autoFillLandArea()` เรียกใน `applyNextCtx()` — เปิดหน้าอาคารจาก flow ได้ `ไร่-งาน-ตร.วา` ของแปลงมาใส่ให้ (กรอกเฉพาะยังว่าง) |
| 4 | **`recalcRemain()` อ่าน key ที่ถูก** | `ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html` | อ่าน `รวมเนื้อที่ทั้งหมด (ตร.ว.)` (ตรงกับที่ collect เก็บ) แทน key เก่าที่ไม่มี + fallback ไร่/งาน/ตร.วา |
| 5 | **`chainState()` ตรวจเชิงลึก** | `home.html` | badge เตือน 2 กรณีใหม่: (a) แปลงมีอาคารแต่ยังไม่แบ่งที่ตั้ง (ประเภท 2/3/4) (b) อาคารยังไม่มีเนื้อที่ที่ดิน |

**Build:** `python build_pwa.py` → `index.html` ใหม่ (295,148 B, 7 ฟอร์ม, SW version `20260821-000252`)

**ทดสอบ Selenium:** ✅ ผ่าน 9/9 (auto-fill 2 ตรวจ / REQUIRED / recalcRemain 2 ตรวจ / badge 5a+5b / loadEditRecord 2 ตรวจ) — ไม่มี JS error
สคริปต์: `C:\Users\NOOM\AppData\Local\Temp\opencode\ltax_sample\test_flow5.py`

---

## 3. Deploy แล้ว ✅

- สคริปต์ใหม่: `C:\Users\NOOM\AppData\Local\Temp\opencode\deploy_flow5.py` (เก่า `deploy_ltax.ps1` ชี้โฟลเดอร์ `web\` เก่า / `deploy_gh.py` ไม่รวม home.html)
- commit: **`6dfa4afb85`** — 9 ไฟล์: index.html, sw.js, manifest.json, home.html, ฟอร์ม 2 ตัว, icons 3
- URL: https://noom25.github.io/ltax-survey/ (ตรวจ raw GitHub ไม่พบ JS error)

---

## 4. งานถัดไป (ยังไม่ทำ — รอสั่ง)

- [ ] ลองใช้งานจริงบนมือถือ (iPhone: เปิด URL + ติดตั้งเป็นแอป + ทดสอบ flow ใหม่ทั้งชุด)
- [ ] รัน `json_to_excel.py` กับข้อมูลจริง → ตรวจ Excel/รูปครบ → รันบอทอัป LTAX Online (ต้อง login+OTP)
- [ ] อัปเดต `คู่มือการใช้งาน.md` ให้ครอบคลุม PWA + หน้าถ่ายรูป + flow ที่ดินให้สิ่งปลูกสร้าง
- [ ] deploy ใหม่ทุกครั้งหลังแก้ฟอร์ม → ใช้ `deploy_flow5.py`

---

## 5. เทียบฟอร์มเรา vs LTAX Online กรม (ตรวจ 3 ชั้น — สรุป)

ตรวจจาก `reference\capture\*.html` (ฟอร์มกรมจริง `ltax.dla.go.th/asset/assetRegis.do`) + `field_mapping_complete.json` + bot ใน `C:\LTAX_Automation\bot_upload_data v1\`

| ฟอร์ม | ฟิลด์ตรงกับกรม | ต่าง/เพิ่มเติม |
|---|---|---|
| เจ้าของ | personType, prefixName, psnId, firstName/lastName, addr*, postal, copyAddr, curr*, tel, email, sendAddr, จ/อ/ต | ยังไม่มี `assetOwner.assetReg4` (รหัส ผ.ท.4 — กรมดึงอัตโนมัติ) |
| ที่ดิน | landGroup, parcelCode, docType(1-13 ตรง), docNo, utm1-4, scale(ตรง), parcelNo, dealingFileNo, volume, page, road/alley/villageNo, rai/ngan/squareWah, totalWah, pricePerWah, totalPrice | เราเพิ่ม `provinceId` (กรม land ใช้แค่ อ/ต — ไม่มีผลลบกับ bot) |
| อาคาร | buildingCode, addrNo, villageNo/Name, road, alley, buildingType(101-501 ตรง), structure, noFloor, width/height, ageStr, since, totalArea, pricePerMeter, totalPrice, depreciation, netPrice, formFile | เราเพิ่ม ตาราง"รหัสแปลง+เนื้อที่ที่ดิน" = ตรง popup เลือกที่ดินของกรม (capture หน้าว่างจึงไม่เห็น) |
| ใช้ที่ดิน | usedType(1-9 ตรง), rai/ngan/squareWah, usedFor, agriType(1-13 ตรง) | ✓ ครบ |
| ใช้อาคาร | usedType(1-5 ตรง), ลักษณะการใช้ | bot ติ๊ก fullArea + usedFor='1' hardcode — ฟอร์มเรารองรับ |
| ป้าย | signboardCode, setupDateStr, addr*, signboardType, character, period(1-4), width/height, totalArea, noSide, unit, taxRate, taxAmount | ✓ ครบ |

### ⚠️ จุดที่กระทบบอท (ต้องระวัง)
1. **ชื่อไฟล์ Excel**: `json_to_excel.py` → `owner_land_building_template.xlsx` แต่ `config.json` bot ตั้ง `_v2` → รันบอทต้อง `--excel owner_land_building_template.xlsx` เสมอ (บัญญัติข้อ 3)
2. **เนื้อที่ที่ดิน** → bot ใช้ match `building.landList[0].landUsedId` — เรา REQUIRED+auto-fill ไปแล้ว พอดีครบ
3. **พื้นที่พาณิชย์** → bot ใช้คิด building usage แบบ mixed (ฟอร์มมีช่อง แต่ไม่บังคับ)
4. **ชื่อคอลัมน์ "อายุสิ่งปลูกสร้าง (ปี)"** — mapping กรมใช้ชื่อนี้ ฟอร์มเราเก็บ "อายุสิ่งปลูกสร้าง" (bot คำนวณเอง ข้ามฟิลด์นี้ ไม่กระทบ แต่ถ้าจะเป๊ะควรเปลี่ยนชื่อให้ตรง)

### 🔲 ทางเลือกที่เสนอไว้ (รอพี่สั่ง)
1. เพิ่มช่อง รหัส ผ.ท.4 (assetReg4) ในฟอร์มเจ้าของ
2. เปลี่ยนชื่อคอลัมน์ "อายุสิ่งปลูกสร้าง" → "อายุสิ่งปลูกสร้าง (ปี)"
3. ขอ capture ฟอร์มกรมเพิ่ม (ตอนมีข้อมูล/popup เลือกที่ดิน) เทียบ landList ให้เป๊ะ
4. รัน `json_to_excel.py` กับข้อมูลทดสอบ ตรวจ Excel เทียบกับที่ bot อ่าน

---

## เทคนิคเด่นในงานนี้ (จำไว้ใช้รอบหน้า)
- `recalcRemain()` ฟอร์มใช้ที่ดินคำนวณคงเหลือโดยอ่านจากแปลงใน localStorage (`รวมเนื้อที่ทั้งหมด (ตร.ว.)`) แล้วลบผลรวมรายการใช้ — กันกรอกเกิน
- `autoFillLandArea()` กรอกเฉพาะเมื่อช่องยังว่าง — ไม่ทับค่าที่ผู้ใช้กรอกเอง/แก้ไข
- `chainState()` เพิ่มเงื่อนไขตรวจ cross-check ระหว่างหมวด (แปลง↔อาคาร) ไม่ใช่แค่เช็คว่ามี record
- deploy ใช้ `gh api` REST (blobs→tree→commit→ref) ไม่ต้องมี git CLI — ใช้สคริปต์ `deploy_flow5.py` ต้นแบบได้เลย