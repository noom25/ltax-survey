# -*- coding: utf-8 -*-
"""Static review helper: check guards across forms + sign form untouched."""
import io, sys, os
sys.stdout.reconfigure(encoding='utf-8')
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def read(name):
    return io.open(name, encoding='utf-8').read()

sign = read('ฟอร์ม_เพิ่มป้าย.html')
print('== sign form guard tokens (expect 0) ==')
for c in ['findLandRecord', 'fillParcelPick', 'ยังไม่มีแปลง', 'onParcelBlur', 'บังคับ']:
    print(' ', repr(c), sign.count(c))

land = read('ฟอร์ม_เพิ่มที่ดิน.html')
i = land.find('function saveLand')
print('== saveLand (land form) ==')
print(land[i:i+520])

lu = read('ฟอร์ม_เพิ่มการใช้ประโยชน์ที่ดิน.html')
i = lu.find('function saveUsed')
print('== saveUsed (land usage form) ==')
print(lu[i:i+420])

bu = read('ฟอร์ม_เพิ่มการใช้ประโยชน์สิ่งปลูกสร้าง.html')
i = bu.find('function saveUsage')
print('== saveUsage (building usage form) ==')
print(bu[i:i+420])

bld = read('ฟอร์ม_เพิ่มสิ่งปลูกสร้าง.html')
print('== building form: checks around land-usage requirement ==')
print('ltax_land_usage mentions in building form:', bld.count('ltax_land_usage'))
