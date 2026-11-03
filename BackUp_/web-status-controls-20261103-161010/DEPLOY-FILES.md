# รายชื่อไฟล์และโฟลเดอร์สำหรับ Deploy ManageFile

ต้นทาง: `G:\M_save\python\ManageFile`

ปลายทาง Ubuntu ตามการตั้งค่าปัจจุบัน: `/root/Web_ManageFile2027/`

## ไฟล์และโฟลเดอร์ที่ต้องอัปโหลด

- [ ] `app.py` — จุดเริ่มต้นของ Flask และ Socket.IO
- [ ] `auth_system.py` — Login, SQLite, JWT อายุ 6 ชั่วโมง
- [ ] `terminal_system.py` — รันคำสั่ง PowerShell / Bash
- [ ] `monitor_system.py` — หน้า Ubuntu Monitor และคำสั่งตรวจสอบระบบ
- [ ] `requirements.txt` — รายชื่อแพ็กเกจ Python
- [ ] `templates/` — อัปโหลดทั้งโฟลเดอร์ พร้อมไฟล์ทั้งหมดด้านล่าง
- [ ] `static/` — อัปโหลดทั้งโฟลเดอร์ พร้อมไฟล์ทั้งหมดด้านล่าง

รวมไฟล์ที่จำเป็น **27 ไฟล์**: ไฟล์หลัก 5 ไฟล์, templates 5 ไฟล์ และ static 17 ไฟล์

```text
Web_ManageFile2027/
├── app.py
├── auth_system.py
├── terminal_system.py
├── monitor_system.py
├── requirements.txt
├── templates/
│   ├── monitor.html
│   ├── index.html
│   ├── auth.html
│   ├── terminal.html
│   └── terminal-panel.html
└── static/
    ├── monitor.css
    ├── monitor.js
    ├── style.css
    ├── style_inline.css
    ├── style_imageZoom.css
    ├── style_Drag_Coverage.css
    ├── explorer-ui.css
    ├── auth.css
    ├── script.js
    ├── script_inline.js
    ├── script_Drag_Coverage.js
    ├── java_imagezoom.js
    ├── jquery-3.7.1.min.js
    ├── explorer-ui.js
    ├── auth-client.js
    ├── terminal.js
    └── chat.js
```

ชื่อไฟล์ต้องตรงตามตัวพิมพ์เล็ก–ใหญ่ โดยเฉพาะบน Ubuntu เช่น `style_imageZoom.css` และ `script_Drag_Coverage.js`

## ข้อมูลบนเซิร์ฟเวอร์ที่ต้องเก็บไว้เมื่ออัปเดต

รายการต่อไปนี้เป็นข้อมูลที่แอปสร้างขึ้น ไม่ต้องอัปโหลดทับจากเครื่องพัฒนาในการอัปเดตโค้ด:

```text
Web_ManageFile2027/
├── instance/
│   └── auth/
│       ├── accounts.sqlite3   # บัญชี รหัสผ่านแบบแฮช เซสชัน และ Bookmarks
│       └── jwt-secret         # กุญแจลงนาม JWT ของเซิร์ฟเวอร์นี้
└── ChatHistory/
    └── *.json                # ประวัติแชต
```

- อย่าลบหรืออัปโหลดทับ `instance/auth/` เมื่ออัปเดต เพื่อรักษาบัญชีและกุญแจ JWT เดิม
- ถ้าตั้ง `MANAGEFILE_AUTH_DIR` ไว้ ข้อมูลบัญชีและกุญแจ JWT จะอยู่ในโฟลเดอร์นั้นแทน
- หากย้ายเซิร์ฟเวอร์และต้องการใช้บัญชีเดิม ให้หยุดแอปแล้วสำรอง `accounts.sqlite3` กับ `jwt-secret` ไปด้วยกัน รวมถึง `ChatHistory/` หากต้องการเก็บแชต
- สำหรับการติดตั้งใหม่ที่ไม่มีข้อมูลเดิม แอปจะสร้างฐานข้อมูลและกุญแจให้เอง จากนั้นตั้งบัญชีแรกผ่าน `/setup`
- Bookmarks เก็บในตาราง `bookmarks` ของ `accounts.sqlite3` แยกตามบัญชีผู้ใช้ และรวมอยู่ในการสำรองฐานข้อมูลด้วย
- รายการเก่าจาก `localStorage` จะถูกนำเข้าอัตโนมัติเมื่อเปิดแอปด้วยเบราว์เซอร์และที่อยู่เว็บเดิมหลังอัปเดต นำเข้าสำเร็จแล้วจึงลบรายการเก่าจากเบราว์เซอร์

## ไฟล์เสริม

| รายการ | ใช้เมื่อ |
| --- | --- |
| `start-admin.ps1` | Deploy บน Windows และต้องการเปิดแอปแบบ Administrator ผ่าน UAC |
| `DEPLOY-UBUNTU.md` | ต้องการคู่มือติดตั้ง/อัปเดต Ubuntu และ nginx |
| `AUTH_README.md` | ต้องการคู่มือบัญชีและ JWT |
| `TERMINAL_README.md` | ต้องการคู่มือ Terminal |
| `DEPLOY-FILES.md` | ต้องการรายการไฟล์ฉบับนี้บนเซิร์ฟเวอร์ |
| `test_auth.py`, `test_terminal.py`, `test_bookmarks.py`, `test_monitor.py` | ต้องการรันชุดทดสอบบนเซิร์ฟเวอร์ |
| `.gitignore` | ต้องการเก็บโปรเจกต์ใน Git |

## รายการที่ไม่จำเป็นสำหรับรันแอป

- `.git/`
- `__pycache__/`
- `BackUp_/`
- `AppFlask_Test/`
- `Graphics/` — ไม่พบการอ้างอิงจากโค้ดแอปปัจจุบัน
- `installServer.py`, `commands.ini`, `getpath.txt` — ไม่ได้ถูกเรียกจากโค้ดแอปปัจจุบัน
- `test.py`, `test.html`, `test.json`, `test.txt`
- `Readme.txt` — เอกสารเดิม

หากโฟลเดอร์เหล่านี้มีไฟล์ส่วนตัวที่ต้องการเปิดผ่าน File Explorer ให้ย้ายแยกตามความต้องการของผู้ใช้

## ตัวอย่างอัปโหลดเฉพาะโค้ดไป Ubuntu

รันจากโฟลเดอร์ต้นทางที่ระบุด้านบน หลังจากสร้างโฟลเดอร์ปลายทางไว้แล้ว:

```powershell
scp app.py auth_system.py terminal_system.py monitor_system.py requirements.txt root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
scp -r templates static root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
```

หลังอัปโหลด ให้ติดตั้งแพ็กเกจจาก `requirements.txt` ใน virtualenv ของเซิร์ฟเวอร์ และรีสตาร์ต `my_script.service` ตาม [คู่มือ Ubuntu](DEPLOY-UBUNTU.md)

พอร์ตเริ่มต้นปัจจุบันคือ **2289** และเปลี่ยนได้ด้วย `MANAGEFILE_PORT`
หน้าเว็บบางส่วนโหลด Bootstrap, Socket.IO, CodeMirror และ Font Awesome จาก CDN จึงต้องเข้าถึง CDN เหล่านั้นได้

## Ubuntu Monitor

เพิ่มไฟล์ `monitor_system.py`, `templates/monitor.html`, `static/monitor.js`, `static/monitor.css` และอัปเดต `app.py`, `auth_system.py`, `templates/index.html` ด้วย เปิดที่ `/monitor` หลังเข้าสู่ระบบ

หน้า Monitor ใช้เครื่องมือระบบ Ubuntu ที่มีอยู่ ไม่เพิ่ม Python dependency ข้อมูลขึ้นกับสิทธิ์ของบัญชีที่รันแอป คำสั่งสิทธิ์สูงใช้ `sudo -n` และแสดงข้อผิดพลาดหากไม่ได้รับอนุญาต ไม่ต้องเปิด sudo ทั้งหมดเพื่อใช้หน้า Monitor

Metrics รีเฟรชทุก 5 วินาที ปรับเป็น 15/30 วินาทีหรือหยุดได้ Nginx และ Ports cache 15 วินาที ส่วน Config/Log/SSL/Disks/Processes โหลดเมื่อกด คำสั่งปกติจำกัด 5 วินาที และ `/var` จำกัด 20 วินาที ไม่แก้ Config ไม่ restart service และไม่อ่านเนื้อหา Private Key

วันหมดอายุ SSL ดูจาก Certbot certificates; Config แสดงเฉพาะตำแหน่งไฟล์และ directive ที่เกี่ยวกับเว็บไซต์/proxy/ใบรับรอง Process CPU เป็นค่าเฉลี่ยตลอดอายุ process ส่วน CPU รวมคำนวณจากตัวอย่าง /proc/stat ระหว่างรอบรีเฟรช

