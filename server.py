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
PORT = 8000


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
            with open(in_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            counts = {}
            for k in ["ltax_owner", "ltax_land", "ltax_land_usage",
                      "ltax_building", "ltax_building_usage", "ltax_sign"]:
                counts[k] = len(data.get(k, []) or [])

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
            msg = "เจ้าของ %d | ที่ดิน %d | ใช้ที่ดิน %d | อาคาร %d | ใช้อาคาร %d | ป้าย %d" % (
                counts["ltax_owner"], counts["ltax_land"], counts["ltax_land_usage"],
                counts["ltax_building"], counts["ltax_building_usage"], counts["ltax_sign"])
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
