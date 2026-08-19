@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo เริ่ม LTAX Offline Server ...
python server.py
pause
