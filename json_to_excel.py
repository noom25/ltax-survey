#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# json_to_excel.py - แปลง ltax_data_all.json (จากฟอร์ม LTAX Offline) -> Excel template
# ที่ bot_add_*.py อ่านได้
#
# วิธีใช้:
#   1) เปิด index.html -> กด "สร้างไฟล์ Excel" -> ได้ ltax_data_all.json
#   2) วาง ltax_data_all.json ในโฟลเดอร์เดียวกับไฟล์นี้
#   3) รัน:  python json_to_excel.py
#      (กำหนดไฟล์อื่น:  python json_to_excel.py --input data.json --output out.xlsx)
#
# Sheet ที่สร้าง:
#   '1_เจ้าของทรัพย์สิน'          : จาก ltax_owner
#   '2_ที่ดิน'                    : จาก ltax_land (ข้อมูลแปลงเท่านั้น)
#   '2_ที่ดิน_ใช้ประโยชน์'        : จาก ltax_land_usage (1 แถว = 1 รายการใช้)
#   '3_สิ่งปลูกสร้าง'             : จาก ltax_building (ข้อมูลตัวอาคารเท่านั้น)
#   '3_สิ่งปลูกสร้าง_ใช้ประโยชน์' : จาก ltax_building_usage (1 แถว = 1 รายการ)
#   'ป้าย'                       : จาก ltax_sign
#
# หมายเหตุ:
#   - แยก sheet แปลง/อาคาร ออกจาก sheet ใช้ประโยชน์
#     เพราะ bot_add_land/bot_add_building groupby แล้ววนทุกแถว
#     ถ้าแถวใช้ประโยชน์ปนมา จะเพิ่มแปลง/อาคารซ้ำ
#   - bot_add_land_usage / bot_add_building_usage ต้องรันด้วย
#     --sheet "2_ที่ดิน_ใช้ประโยชน์" / --sheet "3_สิ่งปลูกสร้าง_ใช้ประโยชน์"

import os
import re
import io
import base64
import json
import argparse
import pandas as pd

PHOTOS_DIR = "photos"

OWNER_HEADERS = [
    "ลำดับ", "เลขบัตรประชาชน", "ประเภทบุคคล", "คำนำหน้า", "ชื่อ", "นามสกุล",
    "สัญชาติ", "เลขที่บ้าน", "หมู่ที่", "ซอย", "ถนน", "ตำบล", "อำเภอ",
    "จังหวัด", "รหัสไปรษณีย์", "โทรศัพท์",
    "สถานะบุคคล", "บ้านเลขที่ปัจจุบัน", "หมู่ที่ปัจจุบัน", "ซอยปัจจุบัน",
    "ถนนปัจจุบัน", "ตำบลปัจจุบัน", "อำเภอปัจจุบัน", "จังหวัดปัจจุบัน",
    "รหัสไปรษณีย์ปัจจุบัน", "อีเมล", "ที่อยู่เพื่อส่งจดหมาย",
]

LAND_HEADERS = [
    "ลำดับ", "เลขบัตรเจ้าของที่ดิน", "รหัสแปลงที่ดิน", "ประเภทเอกสาร",
    "เลขที่เอกสาร", "หน้าสำรวจ", "เล่มที่", "ระวาง", "แผนที่ระวางภูมิประเทศ",
    "ระวางUTM", "มาตราส่วน", "เลขที่ดิน", "หมู่ที่", "ไร่", "งาน", "ตร.วา",
    "ตำบล", "อำเภอ", "จังหวัด", "รวมราคาประเมินที่ดิน (บาท)",
    "ประเภทการใช้ประโยชน์", "ผู้ทำประโยชน์", "การเกษตรที่ทำ", "Path รูปที่ดิน",
    "รหัสกลุ่มที่ดิน", "แผ่นที่ระวางUTM", "หน้าที่", "ถนน", "ซอย",
    "รวมเนื้อที่ทั้งหมด (ตร.ว.)", "ราคาต่อตร.วา", "หมายเหตุ", "หมายเหตุเจ้าหน้าที่",
]

LAND_USAGE_HEADERS = [
    "เลขบัตรเจ้าของที่ดิน", "รหัสแปลงที่ดิน", "ประเภทการใช้ประโยชน์",
    "ไร่", "งาน", "ตร.วา", "ผู้ทำประโยชน์", "ใช้โดย", "เลขบัตรผู้ทำประโยชน์",
    "การเกษตรที่ทำ", "Path รูปที่ดิน", "หมายเหตุ",
]

BUILDING_HEADERS = [
    "ลำดับ", "เลขบัตรเจ้าของที่ดิน", "เลขบัตรเจ้าของสิ่งปลูกสร้าง",
    "รหัสแปลงที่ดิน", "รหัสสิ่งปลูกสร้าง", "รหัสอาคาร", "เลขที่บ้าน",
    "หมู่ที่", "ซอย", "ถนน", "ประเภทอาคาร", "โครงสร้าง", "จำนวนชั้น",
    "กว้าง(ม.)", "ยาว(ม.)", "เนื้อที่ที่ดิน", "ปีที่สร้าง", "ประเภทการใช้งาน",
    "พื้นที่พาณิชย์", "สัดส่วนกรรมสิทธิ์", "Path รูปภาพ",
    "หมู่บ้าน/ชุมชน", "ขนาดพื้นที่ทั้งอาคาร(ตร.ม.)", "อายุสิ่งปลูกสร้าง (ปี)",
    "ราคาประเมินต่อตร.ม.", "ราคาประเมินทุนทรัพย์", "หักค่าเสื่อม",
    "คงเหลือราคาประเมิน", "หมายเหตุ", "หมายเหตุเจ้าหน้าที่",
]

BUILDING_USAGE_HEADERS = [
    "เลขบัตรเจ้าของสิ่งปลูกสร้าง", "รหัสสิ่งปลูกสร้าง", "ประเภทการใช้งาน",
    "เต็มพื้นที่ทุกชั้น", "ชั้นที่", "กว้าง(ม.)", "ยาว(ม.)",
    "พื้นที่รวม(ตร.ม.)", "ขนาดพื้นที่คงเหลือ(ตร.ม.)", "ลักษณะการใช้", "หมายเหตุ",
]

SIGN_HEADERS = [
    "รหัสป้าย", "เลขบัตรเจ้าของป้าย", "ชื่อสถานประกอบการค้า/กิจการ",
    "วันที่ติดตั้งป้าย", "บ้านเลขที่", "หมู่", "ตรอก/ซอย", "ถนน", "ชุมชน",
    "อำเภอ", "ตำบล", "ป้ายแสดง", "ประเภทป้าย", "กว้าง (ซม.)", "ยาว (ซม.)",
    "จำนวนด้าน", "ข้อความภายในป้าย", "งวดที่ติดตั้งป้าย", "จังหวัด",
    "รหัสไปรษณีย์", "โทรศัพท์", "Path รูปภาพ",
    "รหัสแปลงที่ดิน", "เนื้อที่ป้าย (ตร.ซม.)", "จำนวนหน่วย", "อัตราภาษีป้าย",
    "รวมเงินภาษี (บาท)", "หมายเหตุ", "หมายเหตุเจ้าหน้าที่",
]


def to_list(value):
    """แปลงค่าจาก JSON ให้เป็น list อย่างปลอดภัย"""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def first(records, *keys):
    """ดึง record แรก (หรือ dict) แล้วให้ค่า key แรกที่เจอ"""
    if isinstance(records, dict):
        for k in keys:
            if k in records:
                return records[k]
        return ""
    for rec in to_list(records):
        for k in keys:
            if isinstance(rec, dict) and k in rec and str(rec[k]).strip():
                return rec[k]
    return ""


def save_embedded_photo(rec, data_key, code, idx, fallback_key):
    """ถ้า record มีข้อมูลรูปฝัง base64 (รูปภาพ_data / รูปที่ดิน_data) -> เขียนไฟล์จริง + คืน path
    รองรับทั้งรูปเดียว (string) และหลายรูป (list ของ data URL) -> คืน path เรียงทีละบรรทัด
    ถ้าไม่มี -> คืนค่า Path เดิม (fallback_key) ตามปกติ"""
    if not isinstance(rec, dict):
        return ""
    data = rec.get(data_key, "")
    if isinstance(data, list):
        items = [d for d in data if isinstance(d, str) and d.strip()]
        if not items:
            return str(rec.get(fallback_key, "")).strip()
    else:
        data_url = str(data).strip()
        if not data_url:
            return str(rec.get(fallback_key, "")).strip()
        items = [data_url]

    code = str(code).strip() or f"photo{idx}"
    safe = re.sub(r"[^\w\-]+", "_", code) or "photo"

    os.makedirs(PHOTOS_DIR, exist_ok=True)
    paths = []
    for n, data_url in enumerate(items, start=1):
        if not data_url.startswith("data:"):
            paths.append(data_url)
            continue

        try:
            mime, _, b64 = data_url[5:].partition(";base64,")
            if not b64:
                paths.append(data_url)
                continue
            raw = base64.b64decode(b64)
        except Exception:
            paths.append(data_url)
            continue

        if len(items) == 1:
            out_name = f"{safe}_{idx}.jpg"
        else:
            out_name = f"{safe}_{idx}_{n}.jpg"
        out_path = os.path.join(PHOTOS_DIR, out_name)

        converted = _save_image(raw, out_path)
        if converted:
            paths.append(os.path.join(PHOTOS_DIR, out_name))
        else:
            paths.append(data_url)

    return "\n".join(paths)


def _save_image(raw, out_path):
    """ลองบันทึกภาพ (แปลง HEIC -> JPG ถ้าทำได้) คืน True ถ้าสำเร็จ"""
    try:
        from PIL import Image
    except ImportError:
        with open(out_path, "wb") as f:
            f.write(raw)
        return True

    try:
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        img.save(out_path, "JPEG", quality=88)
        return True
    except Exception:
        pass

    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        img.save(out_path, "JPEG", quality=88)
        return True
    except Exception:
        try:
            with open(out_path, "wb") as f:
                f.write(raw)
            return True
        except Exception:
            return False


def flatten_land_usage(records):
    """ltax_land_usage -> 1 แถวต่อ 1 รายการใช้ประโยชน์"""
    rows = []
    for rec in to_list(records):
        psn = first(rec, "เลขบัตรเจ้าของที่ดิน")
        code = first(rec, "รหัสแปลงที่ดิน")
        for i, u in enumerate(to_list(rec.get("รายการใช้ประโยชน์")), start=1):
            rows.append({
                "เลขบัตรเจ้าของที่ดิน": psn,
                "รหัสแปลงที่ดิน": code,
                "ประเภทการใช้ประโยชน์": first(u, "ประเภทการใช้ประโยชน์"),
                "ไร่": first(u, "ไร่"),
                "งาน": first(u, "งาน"),
                "ตร.วา": first(u, "ตร.วา"),
                "ผู้ทำประโยชน์": first(u, "ผู้ทำประโยชน์"),
                "ใช้โดย": first(u, "ใช้โดย"),
                "เลขบัตรผู้ทำประโยชน์": first(u, "เลขบัตรผู้ทำประโยชน์"),
                "การเกษตรที่ทำ": first(u, "การเกษตรที่ทำ"),
                "Path รูปที่ดิน": save_embedded_photo(u, "รูปที่ดิน_data", code, i, "Path รูปที่ดิน"),
                "หมายเหตุ": first(u, "หมายเหตุ"),
            })
    return rows


def flatten_building_usage(records):
    """ltax_building_usage -> 1 แถวต่อ 1 รายการใช้สิ่งปลูกสร้าง"""
    rows = []
    for rec in to_list(records):
        psn = first(rec, "เลขบัตรเจ้าของสิ่งปลูกสร้าง")
        code = first(rec, "รหัสสิ่งปลูกสร้าง")
        for u in to_list(rec.get("รายการใช้ประโยชน์")):
            rows.append({
                "เลขบัตรเจ้าของสิ่งปลูกสร้าง": psn,
                "รหัสสิ่งปลูกสร้าง": code,
                "ประเภทการใช้งาน": first(u, "ประเภทการใช้งาน"),
                "เต็มพื้นที่ทุกชั้น": first(u, "เต็มพื้นที่ทุกชั้น"),
                "ชั้นที่": first(u, "ชั้นที่"),
                "กว้าง(ม.)": first(u, "กว้าง(ม.)"),
                "ยาว(ม.)": first(u, "ยาว(ม.)"),
                "พื้นที่รวม(ตร.ม.)": first(u, "พื้นที่รวม(ตร.ม.)"),
                "ขนาดพื้นที่คงเหลือ(ตร.ม.)": first(u, "ขนาดพื้นที่คงเหลือ(ตร.ม.)"),
                "ลักษณะการใช้": first(u, "ลักษณะการใช้"),
                "หมายเหตุ": first(u, "หมายเหตุ"),
            })
    return rows


def build_owner(records):
    rows = []
    for i, rec in enumerate(to_list(records), start=1):
        rows.append({
            "ลำดับ": i,
            "เลขบัตรประชาชน": first(rec, "เลขบัตรประชาชน"),
            "ประเภทบุคคล": first(rec, "ประเภทบุคคล"),
            "คำนำหน้า": first(rec, "คำนำหน้า"),
            "ชื่อ": first(rec, "ชื่อ"),
            "นามสกุล": first(rec, "นามสกุล"),
            "สัญชาติ": first(rec, "สัญชาติ"),
            "เลขที่บ้าน": first(rec, "เลขที่บ้าน"),
            "หมู่ที่": first(rec, "หมู่ที่"),
            "ซอย": first(rec, "ซอย"),
            "ถนน": first(rec, "ถนน"),
            "ตำบล": first(rec, "ตำบล"),
            "อำเภอ": first(rec, "อำเภอ"),
            "จังหวัด": first(rec, "จังหวัด"),
            "รหัสไปรษณีย์": first(rec, "รหัสไปรษณีย์"),
            "โทรศัพท์": first(rec, "โทรศัพท์"),
            "สถานะบุคคล": first(rec, "สถานะบุคคล"),
            "บ้านเลขที่ปัจจุบัน": first(rec, "บ้านเลขที่ปัจจุบัน"),
            "หมู่ที่ปัจจุบัน": first(rec, "หมู่ที่ปัจจุบัน"),
            "ซอยปัจจุบัน": first(rec, "ซอยปัจจุบัน"),
            "ถนนปัจจุบัน": first(rec, "ถนนปัจจุบัน"),
            "ตำบลปัจจุบัน": first(rec, "ตำบลปัจจุบัน"),
            "อำเภอปัจจุบัน": first(rec, "อำเภอปัจจุบัน"),
            "จังหวัดปัจจุบัน": first(rec, "จังหวัดปัจจุบัน"),
            "รหัสไปรษณีย์ปัจจุบัน": first(rec, "รหัสไปรษณีย์ปัจจุบัน"),
            "อีเมล": first(rec, "อีเมล"),
            "ที่อยู่เพื่อส่งจดหมาย": first(rec, "ที่อยู่เพื่อส่งจดหมาย"),
        })
    return rows


def build_land(records):
    rows = []
    for i, rec in enumerate(to_list(records), start=1):
        rows.append({
            "ลำดับ": i,
            "เลขบัตรเจ้าของที่ดิน": first(rec, "เลขบัตรเจ้าของที่ดิน"),
            "รหัสแปลงที่ดิน": first(rec, "รหัสแปลงที่ดิน"),
            "ประเภทเอกสาร": first(rec, "ประเภทเอกสาร"),
            "เลขที่เอกสาร": first(rec, "เลขที่เอกสาร"),
            "หน้าสำรวจ": first(rec, "หน้าสำรวจ"),
            "เล่มที่": first(rec, "เล่มที่"),
            "ระวาง": first(rec, "ระวาง"),
            "แผนที่ระวางภูมิประเทศ": first(rec, "แผนที่ระวางภูมิประเทศ"),
            "ระวางUTM": first(rec, "ระวางUTM"),
            "มาตราส่วน": first(rec, "มาตราส่วน"),
            "เลขที่ดิน": first(rec, "เลขที่ดิน"),
            "หมู่ที่": first(rec, "หมู่ที่"),
            "ไร่": first(rec, "ไร่"),
            "งาน": first(rec, "งาน"),
            "ตร.วา": first(rec, "ตร.วา"),
            "ตำบล": first(rec, "ตำบล"),
            "อำเภอ": first(rec, "อำเภอ"),
            "จังหวัด": first(rec, "จังหวัด"),
            "รวมราคาประเมินที่ดิน (บาท)": first(rec, "รวมราคาประเมินที่ดิน (บาท)"),
            "ประเภทการใช้ประโยชน์": "",
            "ผู้ทำประโยชน์": "",
            "การเกษตรที่ทำ": "",
            "Path รูปที่ดิน": save_embedded_photo(rec, "รูปที่ดิน_data", first(rec, "รหัสแปลงที่ดิน"), i, "Path รูปที่ดิน"),
            "รหัสกลุ่มที่ดิน": first(rec, "รหัสกลุ่มที่ดิน"),
            "แผ่นที่ระวางUTM": first(rec, "แผ่นที่ระวางUTM"),
            "หน้าที่": first(rec, "หน้าที่"),
            "ถนน": first(rec, "ถนน"),
            "ซอย": first(rec, "ซอย"),
            "รวมเนื้อที่ทั้งหมด (ตร.ว.)": first(rec, "รวมเนื้อที่ทั้งหมด (ตร.ว.)"),
            "ราคาต่อตร.วา": first(rec, "ราคาต่อตร.วา"),
            "หมายเหตุ": first(rec, "หมายเหตุ"),
            "หมายเหตุเจ้าหน้าที่": first(rec, "หมายเหตุเจ้าหน้าที่"),
        })
    return rows


def build_building(records):
    rows = []
    for i, rec in enumerate(to_list(records), start=1):
        rows.append({
            "ลำดับ": i,
            "เลขบัตรเจ้าของที่ดิน": first(rec, "เลขบัตรเจ้าของที่ดิน"),
            "เลขบัตรเจ้าของสิ่งปลูกสร้าง": first(rec, "เลขบัตรเจ้าของสิ่งปลูกสร้าง"),
            "รหัสแปลงที่ดิน": first(rec, "รหัสแปลงที่ดิน"),
            "รหัสสิ่งปลูกสร้าง": first(rec, "รหัสสิ่งปลูกสร้าง"),
            "รหัสอาคาร": first(rec, "รหัสอาคาร"),
            "เลขที่บ้าน": first(rec, "เลขที่บ้าน"),
            "หมู่ที่": first(rec, "หมู่ที่"),
            "ซอย": first(rec, "ซอย"),
            "ถนน": first(rec, "ถนน"),
            "ประเภทอาคาร": first(rec, "ประเภทอาคาร"),
            "โครงสร้าง": first(rec, "โครงสร้าง"),
            "จำนวนชั้น": first(rec, "จำนวนชั้น"),
            "กว้าง(ม.)": first(rec, "กว้าง(ม.)"),
            "ยาว(ม.)": first(rec, "ยาว(ม.)"),
            "เนื้อที่ที่ดิน": first(rec, "เนื้อที่ที่ดิน"),
            "ปีที่สร้าง": first(rec, "ปีที่สร้าง"),
            "ประเภทการใช้งาน": "",
            "พื้นที่พาณิชย์": first(rec, "พื้นที่พาณิชย์"),
            "สัดส่วนกรรมสิทธิ์": first(rec, "สัดส่วนกรรมสิทธิ์"),
            "Path รูปภาพ": save_embedded_photo(rec, "รูปภาพ_data", first(rec, "รหัสสิ่งปลูกสร้าง"), i, "Path รูปภาพ"),
            "หมู่บ้าน/ชุมชน": first(rec, "หมู่บ้าน/ชุมชน"),
            "ขนาดพื้นที่ทั้งอาคาร(ตร.ม.)": first(rec, "ขนาดพื้นที่ทั้งอาคาร(ตร.ม.)"),
            "อายุสิ่งปลูกสร้าง (ปี)": first(rec, "อายุสิ่งปลูกสร้าง (ปี)", "อายุสิ่งปลูกสร้าง"),
            "ราคาประเมินต่อตร.ม.": first(rec, "ราคาประเมินต่อตร.ม."),
            "ราคาประเมินทุนทรัพย์": first(rec, "ราคาประเมินทุนทรัพย์"),
            "หักค่าเสื่อม": first(rec, "หักค่าเสื่อม"),
            "คงเหลือราคาประเมิน": first(rec, "คงเหลือราคาประเมิน"),
            "หมายเหตุ": first(rec, "หมายเหตุ"),
            "หมายเหตุเจ้าหน้าที่": first(rec, "หมายเหตุเจ้าหน้าที่"),
        })
    return rows


def build_sign(records):
    rows = []
    for i, rec in enumerate(to_list(records), start=1):
        rows.append({
            "รหัสป้าย": first(rec, "รหัสป้าย"),
            "เลขบัตรเจ้าของป้าย": first(rec, "เลขบัตรเจ้าของป้าย"),
            "ชื่อสถานประกอบการค้า/กิจการ": first(rec, "ชื่อสถานประกอบการค้า/กิจการ"),
            "วันที่ติดตั้งป้าย": first(rec, "วันที่ติดตั้งป้าย"),
            "บ้านเลขที่": first(rec, "บ้านเลขที่"),
            "หมู่": first(rec, "หมู่"),
            "ตรอก/ซอย": first(rec, "ตรอก/ซอย"),
            "ถนน": first(rec, "ถนน"),
            "ชุมชน": first(rec, "ชุมชน"),
            "อำเภอ": first(rec, "อำเภอ"),
            "ตำบล": first(rec, "ตำบล"),
            "ป้ายแสดง": first(rec, "ป้ายแสดง"),
            "ประเภทป้าย": first(rec, "ประเภทป้าย"),
            "กว้าง (ซม.)": first(rec, "กว้าง (ซม.)"),
            "ยาว (ซม.)": first(rec, "ยาว (ซม.)"),
            "จำนวนด้าน": first(rec, "จำนวนด้าน"),
            "ข้อความภายในป้าย": first(rec, "ข้อความภายในป้าย"),
            "งวดที่ติดตั้งป้าย": first(rec, "งวดที่ติดตั้งป้าย"),
            "จังหวัด": first(rec, "จังหวัด"),
            "รหัสไปรษณีย์": first(rec, "รหัสไปรษณีย์"),
            "โทรศัพท์": first(rec, "โทรศัพท์"),
            "Path รูปภาพ": save_embedded_photo(rec, "รูปภาพ_data", first(rec, "รหัสป้าย"), i, "Path รูปภาพ"),
            "รหัสแปลงที่ดิน": first(rec, "รหัสแปลงที่ดิน"),
            "เนื้อที่ป้าย (ตร.ซม.)": first(rec, "เนื้อที่ป้าย (ตร.ซม.)"),
            "จำนวนหน่วย": first(rec, "จำนวนหน่วย"),
            "อัตราภาษีป้าย": first(rec, "อัตราภาษีป้าย"),
            "รวมเงินภาษี (บาท)": first(rec, "รวมเงินภาษี (บาท)"),
            "หมายเหตุ": first(rec, "หมายเหตุ"),
            "หมายเหตุเจ้าหน้าที่": first(rec, "หมายเหตุเจ้าหน้าที่"),
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description="แปลง ltax_data_all.json -> Excel template")
    parser.add_argument("--input", type=str, default="ltax_data_all.json",
                        help="ไฟล์ JSON รวมข้อมูล (default: ltax_data_all.json)")
    parser.add_argument("--output", type=str, default="owner_land_building_template.xlsx",
                        help="ไฟล์ Excel ปลายทาง (default: owner_land_building_template.xlsx)")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        print(f"❌ ไม่พบไฟล์ {args.input}")
        print("   1) เปิด index.html -> กด 'สร้างไฟล์ Excel' -> ได้ ltax_data_all.json")
        print("   2) วาง ltax_data_all.json ในโฟลเดอร์เดียวกับไฟล์นี้ แล้วรันใหม่")
        return

    with open(args.input, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    sheets = {
        "1_เจ้าของทรัพย์สิน": (OWNER_HEADERS, build_owner(data.get("ltax_owner", []))),
        "2_ที่ดิน": (LAND_HEADERS, build_land(data.get("ltax_land", []))),
        "2_ที่ดิน_ใช้ประโยชน์": (LAND_USAGE_HEADERS, flatten_land_usage(data.get("ltax_land_usage", []))),
        "3_สิ่งปลูกสร้าง": (BUILDING_HEADERS, build_building(data.get("ltax_building", []))),
        "3_สิ่งปลูกสร้าง_ใช้ประโยชน์": (BUILDING_USAGE_HEADERS, flatten_building_usage(data.get("ltax_building_usage", []))),
        "ป้าย": (SIGN_HEADERS, build_sign(data.get("ltax_sign", []))),
    }

    with pd.ExcelWriter(args.output, engine="openpyxl") as writer:
        for sheet_name, (headers, rows) in sheets.items():
            if rows:
                df = pd.DataFrame(rows, columns=headers)
            else:
                df = pd.DataFrame(columns=headers)
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    print("✅ สร้างไฟล์สำเร็จ:", args.output)
    for sheet_name, (headers, rows) in sheets.items():
        print(f"   - {sheet_name}: {len(rows)} แถว")


if __name__ == "__main__":
    main()
