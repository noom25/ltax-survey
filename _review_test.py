# -*- coding: utf-8 -*-
"""Selenium review tests v2 — fixes: noFloor, areaStr after fullArea, alert-safe JS calls."""
import io, os, sys, time, threading
sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
import http.server, socketserver

PORT = 8013

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = socketserver.TCPServer(('127.0.0.1', PORT), Q)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select
from webdriver_manager.chrome import ChromeDriverManager
from selenium.common.exceptions import NoAlertPresentException

opts = Options()
opts.add_argument('--headless=new')
opts.add_argument('--window-size=1280,900')
d = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)
d.implicitly_wait(3)

BASE = 'http://127.0.0.1:%d/index.html' % PORT
results = []

def res(name, ok, note=''):
    results.append((name, ok, note))
    print(('PASS' if ok else 'MISS'), '|', name, '|', note)

def js(expr):
    return d.execute_script('return (%s);' % expr)

def js_safe(script):
    """Run JS, auto-dismiss any alert it opens, return None."""
    try:
        d.execute_script(script)
    except Exception as e:
        eat_alert()
        d.execute_script(script)
    eat_alert()

def eat_alert():
    try:
        a = d.switch_to.alert
        t = a.text; a.accept(); return t
    except NoAlertPresentException:
        return None

def wait_alert(sec=4.0):
    end = time.time() + sec
    while time.time() < end:
        t = eat_alert()
        if t is not None: return t
        time.sleep(0.15)
    return None

def open_spa(fid, edit=None):
    d.execute_script('window.__editQuery = %r;' % (edit or 'null'))
    d.execute_script('openForm(%r);' % fid)
    time.sleep(0.4)

def click_btn_text(txt):
    js_safe("var bs=document.querySelectorAll('button'); for(var i=0;i<bs.length;i++){if(bs[i].textContent.trim()==='%s'){bs[i].click();break;}}" % txt)

def counts():
    return {k: len(js("JSON.parse(localStorage.getItem('%s')||'[]')" % k) or [])
            for k in ['ltax_owner','ltax_land','ltax_land_usage','ltax_building','ltax_building_usage','ltax_sign']}

def clear_storage():
    d.execute_script('localStorage.clear(); sessionStorage.clear();')

def fill_building(pcode, bcode):
    d.find_element(By.ID, 'landParcelCode').clear()
    d.find_element(By.ID, 'landParcelCode').send_keys(pcode)
    d.find_element(By.ID, 'buildingCode').send_keys(bcode)
    d.find_element(By.ID, 'landAreaStr').send_keys('0-0-50')
    Select(d.find_element(By.ID, 'buildingType')).select_by_value('101')
    Select(d.find_element(By.ID, 'structure')).select_by_value('1')
    d.find_element(By.ID, 'noFloor').send_keys('1')
    d.find_element(By.ID, 'widthStr').send_keys('5')
    d.find_element(By.ID, 'heightStr').send_keys('6')
    d.find_element(By.ID, 'ageStr').send_keys('3')
    js('calTotalArea(); recalcPrice(); calLandAreaWah();')

print('== T1: building form direct, parcel not in system -> must be blocked ==')
d.get(BASE)
time.sleep(1.5)
clear_storage()
open_spa('ltax_building')
fill_building('50X1', '50X1-B1')
click_btn_text('บันทึก')
txt = wait_alert()
c = counts()
res('T1 building blocked w/o land', (txt is not None and 'ยังไม่มีแปลง' in txt) and c['ltax_building'] == 0,
    'alert=%r count=%d' % (txt, c['ltax_building']))

print('== T1b: same but WITH existing land -> save must succeed ==')
js("""
 localStorage.setItem('ltax_owner', JSON.stringify([{'เลขบัตรประชาชน':'3100501234567','คำนำหน้า':'1','ชื่อ':'เจ้า','นามสกุล':'แปลง'}]));
 localStorage.setItem('ltax_land', JSON.stringify([{'เลขบัตรเจ้าของที่ดิน':'3100501234567','รหัสแปลงที่ดิน':'50T1B','ไร่':'2','งาน':'0','ตร.วา':'0','รวมเนื้อที่ทั้งหมด (ตร.ว.)':'800.00'}]));
""")
open_spa('ltax_building')
fill_building('50T1B', '50T1B-B1')
click_btn_text('บันทึก')
txt = wait_alert()
c = counts()
res('T1b building saves WITH existing land', c['ltax_building'] == 1 and txt is None, 'alert=%r count=%d' % (txt, c['ltax_building']))
js("var m=document.getElementById('ltaxModal'); if(m) m.style.display='none';")

print('== T1c: others-land case (different owner) -> same gate applies ==')
clear_storage()
js("""
 localStorage.setItem('ltax_owner', JSON.stringify([{'เลขบัตรประชาชน':'9999999999999','คำนำหน้า':'1','ชื่อ':'เจ้าของ','นามสกุล':'แปลง'}]));
 localStorage.setItem('ltax_land', JSON.stringify([{'เลขบัตรเจ้าของที่ดิน':'9999999999999','รหัสแปลงที่ดิน':'50OTHER','ไร่':'1','งาน':'0','ตร.วา':'0'}]));
""")
open_spa('ltax_building')
fill_building('50OTHER', '50OTHER-B1')
js("owners=[{psnId:'3100501234567', fullName:'ผู้ปลูกบ้าน'}]; renderOwners();")
click_btn_text('บันทึก')
txt = wait_alert()
c = counts()
hint = js("document.getElementById('parcelHint').textContent") or ''
res('T1c others-land building allowed (parcel exists)', c['ltax_building'] == 1 and txt is None,
    'alert=%r count=%d hint=%r' % (txt, c['ltax_building'], hint[:80]))
js("var m=document.getElementById('ltaxModal'); if(m) m.style.display='none';")

print('== T2: land form direct, NO owner -> spec says must block ==')
clear_storage()
open_spa('ltax_land')
Select(d.find_element(By.ID, 'docType')).select_by_value('1')
d.find_element(By.ID, 'parcelCode').send_keys('50T2')
d.find_element(By.ID, 'raiStr').clear(); d.find_element(By.ID, 'raiStr').send_keys('2')
js('calTotalWah();')
d.find_element(By.ID, 'pricePerWahStr').send_keys('150')
js('calTotalPrice();')
js('window.__dirty=false;')
click_btn_text('บันทึก')
txt = wait_alert()
c = counts()
saved = c['ltax_land'] == 1
res('T2 land WITHOUT owner blocked (spec)', not saved, 'alert=%r saved=%s' % (txt, saved))
js("var m=document.getElementById('ltaxModal'); if(m) m.style.display='none';")

print('== T3: land_usage direct, parcel not in system ==')
clear_storage()
open_spa('ltax_land_usage')
d.find_element(By.ID, 'psnId').send_keys('1234567890123')
d.find_element(By.ID, 'landParcelCode').send_keys('50X1')
Select(d.find_element(By.ID, 'usedType')).select_by_value('6')
d.find_element(By.ID, 'raiStr').clear(); d.find_element(By.ID, 'raiStr').send_keys('1')
js_safe('addUsage();')
click_btn_text('ตกลง')
txt = wait_alert()
c = counts()
saved = c['ltax_land_usage'] == 1
res('T3 land_usage blocked w/o existing land (spec)', not saved, 'alert=%r saved=%s' % (txt, saved))
js("var m=document.getElementById('ltaxModal'); if(m) m.style.display='none';")

print('== T4: building_usage direct, building not in system ==')
clear_storage()
open_spa('ltax_building_usage')
d.find_element(By.ID, 'buildingCode').send_keys('50X1-B9')
d.find_element(By.ID, 'psnId').send_keys('1234567890123')
Select(d.find_element(By.ID, 'usedType')).select_by_value('1')
js("document.getElementById('fullArea').click(); document.getElementById('areaStr').value='30';")
js_safe('addUsage();')
click_btn_text('ตกลง')
txt = wait_alert()
c = counts()
saved = c['ltax_building_usage'] == 1
res('T4 building_usage blocked w/o existing building (spec)', not saved, 'alert=%r saved=%s' % (txt, saved))
js("var m=document.getElementById('ltaxModal'); if(m) m.style.display='none';")

print('== T5: normal chain owner -> land -> usage -> building -> building_usage ==')
clear_storage()
d.execute_script("window.__goHome && window.__goHome();")
time.sleep(0.3)
open_spa('ltax_owner')
Select(d.find_element(By.ID, 'personType')).select_by_value('1')
d.find_element(By.ID, 'psnId').send_keys('3100501234567')
try: Select(d.find_element(By.ID, 'prefixName')).select_by_value('1')
except Exception: pass
d.find_element(By.ID, 'firstName').send_keys('สมชาย')
d.find_element(By.ID, 'lastName').send_keys('ทดสอบ')
d.find_element(By.ID, 'addrNo').send_keys('25')
d.find_element(By.ID, 'currNo').send_keys('25')
js('window.__dirty=false;')
click_btn_text('บันทึก')
txt = wait_alert()
modal = js("var m=document.getElementById('ltaxModal'); return m && m.style.display!=='none';")
c = counts()
if c['ltax_owner'] == 1 and modal:
    res('T5a owner saved + modal', True, '')
    d.find_element(By.ID, 'ltaxModalNext').click(); time.sleep(0.8)
    owners_cell = js("var t=document.getElementById('ownerTable'); return t? t.textContent : '';") or ''
    auto_owner = '3100501234567' in owners_cell
    Select(d.find_element(By.ID, 'docType')).select_by_value('1')
    d.find_element(By.ID, 'parcelCode').send_keys('50T5')
    d.find_element(By.ID, 'raiStr').clear(); d.find_element(By.ID, 'raiStr').send_keys('2')
    js('calTotalWah();')
    d.find_element(By.ID, 'pricePerWahStr').send_keys('150')
    js('calTotalPrice();')
    click_btn_text('บันทึก')
    txt = wait_alert()
    if txt: print('  land alert:', txt)
    d.find_element(By.ID, 'ltaxModalNext').click(); time.sleep(0.8)
    psn = js("document.getElementById('psnId').value")
    pc = js("document.getElementById('landParcelCode').value")
    res('T5b land->usage autofill + owner auto on land', psn == '3100501234567' and pc == '50T5' and auto_owner,
        'psn=%r pc=%r auto_owner=%r' % (psn, pc, auto_owner))
    Select(d.find_element(By.ID, 'usedType')).select_by_value('6')
    d.find_element(By.ID, 'raiStr').clear(); d.find_element(By.ID, 'raiStr').send_keys('2')
    js_safe('addUsage();')
    click_btn_text('ตกลง')
    txt = wait_alert()
    if txt: print('  usage alert:', txt)
    d.find_element(By.ID, 'ltaxModalNext').click(); time.sleep(0.8)
    bpc = js("document.getElementById('landParcelCode').value")
    la = js("document.getElementById('landAreaStr').value")
    res('T5c building autofill parcel + landArea', bpc == '50T5', 'pc=%r landArea(auto)=%r' % (bpc, la))
    d.find_element(By.ID, 'buildingCode').send_keys('50T5-B1')
    Select(d.find_element(By.ID, 'buildingType')).select_by_value('101')
    Select(d.find_element(By.ID, 'structure')).select_by_value('1')
    d.find_element(By.ID, 'noFloor').send_keys('1')
    d.find_element(By.ID, 'widthStr').send_keys('5')
    d.find_element(By.ID, 'heightStr').send_keys('6')
    d.find_element(By.ID, 'ageStr').send_keys('3')
    js('calTotalArea(); recalcPrice();')
    click_btn_text('บันทึก')
    txt = wait_alert()
    if txt: print('  building alert:', txt)
    d.find_element(By.ID, 'ltaxModalNext').click(); time.sleep(0.8)
    bc = js("document.getElementById('buildingCode').value")
    psn2 = js("document.getElementById('psnId').value")
    res('T5d building_usage autofill', bc == '50T5-B1' and psn2 == '3100501234567', 'bc=%r psn=%r' % (bc, psn2))
    Select(d.find_element(By.ID, 'usedType')).select_by_value('1')
    js("document.getElementById('fullArea').click(); document.getElementById('areaStr').value='30';")
    js_safe('addUsage();')
    click_btn_text('ตกลง')
    txt = wait_alert()
    nosign_visible = js("var b=document.getElementById('ltaxModalNoSign'); return b && b.style.display!=='none';")
    d.find_element(By.ID, 'ltaxModalNoSign').click(); time.sleep(0.6)
    home_visible = js("var h=document.getElementById('view-home'); return h && h.style.display!=='none';")
    c = counts()
    res('T5e full chain + no-sign home', c == {'ltax_owner':1,'ltax_land':1,'ltax_land_usage':1,'ltax_building':1,'ltax_building_usage':1,'ltax_sign':0} and home_visible and nosign_visible,
        'counts=%s nosign=%s home=%s' % (c, nosign_visible, home_visible))
else:
    res('T5a owner saved + modal', False, 'alert=%r modal=%s counts=%s' % (txt, modal, c))

print('== T6: sign opens freely ==')
open_spa('ltax_sign')
time.sleep(0.5)
sign_head = js("var h=document.querySelector('#view-form .panel-head'); return h? h.textContent : '';")
t = eat_alert()
res('T6 sign opens freely', bool(sign_head) and t is None, 'head=%r alert=%r' % ((sign_head or '')[:40], t))

print('== T7: legacy floating building edit ==')
d.execute_script("window.__goHome && window.__goHome();")
time.sleep(0.3)
clear_storage()
js("""
  localStorage.setItem('ltax_building', JSON.stringify([{'เลขบัตรเจ้าของที่ดิน':'3100501234567','เลขบัตรเจ้าของสิ่งปลูกสร้าง':'3100501234567',
    'รหัสแปลงที่ดิน':'50LEGACY','รหัสสิ่งปลูกสร้าง':'50LEGACY-B1','ประเภทอาคาร':'101','โครงสร้าง':'1',
    'ขนาดพื้นที่ทั้งอาคาร(ตร.ม.)':'30.00','เนื้อที่ที่ดิน':'0-0-50','อายุสิ่งปลูกสร้าง':'5'}]));
""")
open_spa('ltax_building', edit="?editKey=ltax_building&editIdx=0")
time.sleep(0.6)
code_loaded = js("document.getElementById('buildingCode').value")
pc_loaded = js("document.getElementById('landParcelCode').value")
res('T7a legacy building loads in edit mode', code_loaded == '50LEGACY-B1' and pc_loaded == '50LEGACY', 'code=%r pc=%r' % (code_loaded, pc_loaded))
js('window.__dirty=false;')
click_btn_text('บันทึก')
txt = wait_alert()
c = counts()
res('T7b legacy save behavior (info)', True, 'alert=%r count=%d — แก้ไขแล้วกดบันทึกถูก guard กันเช่นกัน (พฤติกรรมปัจจุบัน)' % (txt, c['ltax_building']))

print()
print('==== SUMMARY ====')
for n, ok, note in results:
    print(('PASS' if ok else 'MISS'), n)
d.quit()
srv.shutdown()
