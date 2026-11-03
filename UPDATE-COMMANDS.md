# คำสั่งอัปเดต ManageFile แยกไฟล์

รันบน **Windows PowerShell ในเครื่องที่มีไฟล์ต้นฉบับ** สคริปต์จะใช้ไฟล์ข้างตัวเอง จึงรันจากโฟลเดอร์ไหนก็ได้

## 1. ตรวจไฟล์ก่อน โดยยังไม่ติดต่อเซิร์ฟเวอร์

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "G:\M_save\python\ManageFile\UPDATE-MANAGEFILE.ps1" -CheckOnly
```

ต้องแสดง `Validated 29 required files.` หากมีไฟล์ขาดจะหยุดและระบุพาธของไฟล์นั้น

## 2. อัปโหลดและติดตั้ง

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "G:\M_save\python\ManageFile\UPDATE-MANAGEFILE.ps1"
```

SSH จะขอรหัสผ่าน/การยืนยัน Host Key ตามปกติ และอาจขอมากกว่าหนึ่งครั้ง สคริปต์ไม่เก็บรหัสผ่าน หากใช้ SSH Key อยู่แล้วจะใช้การตั้งค่า SSH เดิม

ค่าปัจจุบัน:

- Server: `root@managefile.cayoshibot.com`
- โฟลเดอร์แอป: `/root/Web_ManageFile2027`
- Service: `Web_ManageFile2027.service`
- Python: `/root/Web_ManageFile2027/venv/bin/python3`

ถ้า Service ใช้ Python คนละพาธ สคริปต์จะหยุดและแสดง ExecStart ตรวจพาธได้ด้วย:

```powershell
ssh root@managefile.cayoshibot.com "systemctl show Web_ManageFile2027.service --property=ExecStart --value"
```

จากนั้นระบุพาธที่ตรงกับ Service เช่น:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "G:\M_save\python\ManageFile\UPDATE-MANAGEFILE.ps1" -Python "/root/venv/bin/python"
```

## สคริปต์ทำอะไรบ้าง

1. ตรวจไฟล์ที่จำเป็นครบ 29 ไฟล์
2. อัปโหลดไปโฟลเดอร์พัก `/tmp/managefile-update-...` แล้วตรวจ SHA-256
3. ตรวจ Syntax Python และตรวจว่า Service ใช้ app.py/Python ตรงกับปลายทาง
4. สำรองโค้ดเดิมลง `/root/Web_ManageFile2027/BackUp_/deploy-...`
5. ติดตั้งแพ็กเกจจาก requirements.txt แล้วหยุดแอปชั่วคราวเพื่อคัดลอกไฟล์
6. ตรวจ SHA-256 ของไฟล์ที่ติดตั้งจริง เริ่ม Service และแสดง Status/Log

จะเห็น `UPDATE COMPLETE - 29 file checksums verified` เมื่อสำเร็จ ไม่มีการอัปโหลดทับ `instance/auth/` หรือข้อมูลส่วนตัว หากติดตั้งล้มเหลว สคริปต์จะแสดงพาธสำรองและ Log พร้อมพยายามเริ่ม Service กลับ แต่ไม่ได้กู้โค้ดหรือแพ็กเกจอัตโนมัติ

## 3. เปิดหน้าเว็บหลังอัปเดต

เปิด `https://managefile.cayoshibot.com/monitor` แล้วกด **Ctrl+F5**

หากไฟล์ผ่าน checksum แต่ยังเห็นหน้าเก่า ให้ดู `ExecStart` และ Status/Log ที่สคริปต์แสดง เพื่อยืนยันว่า Service รันจากโฟลเดอร์เดียวกับที่อัปโหลด หาก nginx ชี้ไปอีกแอปหรืออีกพอร์ต ต้องแก้การตั้งค่านั้นแยกต่างหาก
