# -*- coding: utf-8 -*-
"""เว็บ server กลาง: serve โฟลเดอร์ web\ ให้มือถือเข้าถึง + รับ JSON จากมือถือ
แล้วแปลงเป็น Excel (json_to_excel.py) ให้อัตโนมัติ

วิธีใช้: ดับเบิลคลิก start_server.bat (หรือรัน python server.py)
แล้วเปิด URL ที่แสดงบน iPhone/iPad/Android
"""
import os
import re
import sys
import json
import socket
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
if not os.path.isdir(WEB_DIR):
    WEB_DIR = BASE_DIR  # โครงสร้างใหม่: ไฟล์เว็บอยู่ที่ root ตรง ๆ (ไม่แยก web\)
PORT = 8000

# ล็อกป้องกัน race condition เวลามีหลายเครื่องส่งข้อมูลพร้อมกัน
# (ThreadingHTTPServer รันแต่ละ request คนละ thread)
_upload_lock = threading.Lock()

# key ของแต่ละหมวดข้อมูลที่ต้อง merge
DATA_KEYS = ["ltax_owner", "ltax_land", "ltax_land_usage",
             "ltax_building", "ltax_building_usage", "ltax_sign"]


def _merge_category(old_list, new_list):
    """Merge ข้อมูล 1 หมวด (เช่น ltax_land_usage) เป็น 2 ชั้น:

    1) parcel_code: ฟอร์มสำรวจตอนแก้ไขแปลงเดิม จะส่ง "ครบทั้งชุด" ของแปลงนั้น
       เสมอ (เช่น แปลงหนึ่งมี usage 3 รายการ ก็ส่งมาทั้ง 3 ทุกครั้งที่แก้ไข)
       ดังนั้นถ้า submission นี้มี parcel_code ไหนอยู่ ให้ตัด record เก่าที่มี
       parcel_code นั้นในหมวดนี้ทิ้งทั้งหมด แล้วแทนที่ด้วยชุดใหม่ทั้งชุด
       (ไม่ใช่ merge ทีละรายการ — เพราะฟอร์มส่งครบชุดอยู่แล้ว)
    2) record ที่ไม่มี parcel_code (เช่นยังไม่ผูกกับแปลง) -> upsert ตาม _uid
       เหมือนเดิม กันซ้ำกรณีเครื่องเดิมแก้ไข record เดิมแล้วส่งซ้ำ
    """
    new_parcel_codes = {
        item.get("parcel_code")
        for item in new_list
        if isinstance(item, dict) and item.get("parcel_code")
    }

    # ตัด record เก่าของทุก parcel_code ที่ถูกส่งมาใหม่รอบนี้ทิ้ง (จะถูกแทนที่ทั้งชุด)
    result = [
        item for item in old_list
        if not (isinstance(item, dict) and item.get("parcel_code") in new_parcel_codes)
    ]

    uid_pos = {
        item.get("_uid"): pos
        for pos, item in enumerate(result)
        if isinstance(item, dict) and item.get("_uid")
    }

    for item in new_list:
        is_dict = isinstance(item, dict)
        parcel_code = item.get("parcel_code") if is_dict else None
        if parcel_code:
            # อยู่ในกลุ่มที่ถูกแทนที่ทั้งชุดแล้วด้านบน -> เติมเข้าไปตรง ๆ
            result.append(item)
            uid = item.get("_uid") if is_dict else None
            if uid:
                uid_pos[uid] = len(result) - 1
        else:
            uid = item.get("_uid") if is_dict else None
            if uid and uid in uid_pos:
                result[uid_pos[uid]] = item  # แก้ไข record เดิมแล้วส่งซ้ำ -> แทนที่
            else:
                if uid:
                    uid_pos[uid] = len(result)
                result.append(item)  # record ใหม่จริง ๆ -> เพิ่มเข้าไป

    return result


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def _json_response(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/upload":
            self.handle_upload()
        else:
            self._json_response(404, {"ok": False, "error": "ไม่พบเส้นทาง %s" % path})

    def handle_upload(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("ข้อมูลต้องเป็น JSON object")

            in_file = os.path.join(BASE_DIR, "ltax_data_all.json")
            out_file = os.path.join(BASE_DIR, "owner_land_building_template.xlsx")

            # ล็อกทั้งช่วง อ่าน-merge-เขียน-แปลง Excel กันชนกันเวลาหลายเครื่องส่งพร้อมกัน
            with _upload_lock:
                existing = {}
                if os.path.exists(in_file):
                    try:
                        with open(in_file, "r", encoding="utf-8") as f:
                            loaded = json.load(f)
                        if isinstance(loaded, dict):
                            existing = loaded
                    except Exception:
                        # ไฟล์เดิมอ่านไม่ได้/เสีย -> สำรองไว้ก่อนเขียนทับ ป้องกันข้อมูลหายเงียบ ๆ
                        try:
                            backup = in_file + ".corrupt.%d.bak" % int(__import__("time").time())
                            os.replace(in_file, backup)
                        except Exception:
                            pass
                        existing = {}

                merged = dict(existing)
                new_counts = {}
                for k in DATA_KEYS:
                    old_list = existing.get(k, []) or []
                    new_list = data.get(k, []) or []
                    new_counts[k] = len(new_list)
                    merged[k] = _merge_category(old_list, new_list)

                with open(in_file, "w", encoding="utf-8") as f:
                    json.dump(merged, f, ensure_ascii=False, indent=2)

                photos_dir = os.path.join(BASE_DIR, "photos")
                n_photo_before = len(os.listdir(photos_dir)) if os.path.isdir(photos_dir) else 0

                env = dict(os.environ)
                env["PYTHONIOENCODING"] = "utf-8"
                proc = subprocess.run(
                    [sys.executable, "json_to_excel.py",
                     "--input", in_file, "--output", out_file],
                    cwd=BASE_DIR, capture_output=True, text=True, timeout=120, env=env)
                if proc.returncode != 0:
                    self._json_response(500, {
                        "ok": False, "error": "แปลง Excel ไม่สำเร็จ: " + (proc.stderr or proc.stdout)[-500:]
                    })
                    return

                n_photo_after = len(os.listdir(photos_dir)) if os.path.isdir(photos_dir) else 0

            msg = "รับเพิ่ม -> เจ้าของ %d | ที่ดิน %d | ใช้ที่ดิน %d | อาคาร %d | ใช้อาคาร %d | ป้าย %d  (รวมสะสม -> เจ้าของ %d | ที่ดิน %d)" % (
                new_counts["ltax_owner"], new_counts["ltax_land"], new_counts["ltax_land_usage"],
                new_counts["ltax_building"], new_counts["ltax_building_usage"], new_counts["ltax_sign"],
                len(merged.get("ltax_owner", [])), len(merged.get("ltax_land", [])))
            self._json_response(200, {
                "ok": True,
                "msg": msg,
                "excel": "owner_land_building_template.xlsx",
                "photos": "%d รูป (ใหม่ %d)" % (n_photo_after, max(0, n_photo_after - n_photo_before)),
                "json": "ltax_data_all.json"
            })
        except Exception as e:
            self._json_response(500, {"ok": False, "error": str(e)})

    def do_GET(self):
        if urlparse(self.path).path == "/":
            self.path = "/index.html"
        super().do_GET()


def main():
    ip = get_lan_ip()
    print("=" * 58)
    print("  LTAX Offline Server  (serve web/ + รับข้อมูลจากมือถือ)")
    print("=" * 58)
    print("  เปิดบนมือถือ (iPhone/iPad/Android) ได้ที่:")
    print("    http://%s:%d" % (ip, PORT))
    print("    http://localhost:%d   (เครื่องนี้เท่านั้น)" % PORT)
    print("=" * 58)
    print("  เปิดค้างไว้ได้เลย — มือถือกด 'ส่งข้อมูลไปคอมฯ' แล้ว")
    print("  ข้อมูลจะถูกแปลงเป็น Excel ให้อัตโนมัติในโฟลเดอร์นี้")
    print("  (กด Ctrl+C เพื่อปิด server)")
    print("=" * 58)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nปิด server แล้ว")
        server.server_close()


if __name__ == "__main__":
    main()
