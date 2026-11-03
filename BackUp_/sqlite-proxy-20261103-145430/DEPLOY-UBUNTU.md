# ติดตั้งบน Ubuntu

- โฮสต์: `managefile.cayoshibot.com`
- ไฟล์แอป: `/root/Web_ManageFile2027/app.py`
- พอร์ตของแอป: `2289`
- ที่อยู่เว็บผ่าน nginx: `https://managefile.cayoshibot.com/`
- แอปหลัง nginx: `127.0.0.1:2289`
- virtualenv ของ Python: `/root/Web_ManageFile2027/venv`
- ชื่อบริการ: `my_script.service`

`app.py` เปิดรับการเชื่อมต่อที่ `0.0.0.0:2289` ทุกคำสั่ง SSH จะถามรหัสผ่านของ `root` คำสั่งเหล่านี้ไม่อัปโหลดทับและไม่ลบ `instance/auth` กับ `ChatHistory` บนเซิร์ฟเวอร์ ดังนั้นบัญชีผู้ใช้และความลับของ JWT ยังอยู่ที่เดิม

## อัปเดตแอป

ใช้เมื่อเซิร์ฟเวอร์ติดตั้งไว้แล้ว และต้องการส่งโค้ดชุดใหม่ขึ้นไป รันในโฟลเดอร์ `G:\M_save\python\ManageFile` บน Windows คำสั่งจะสร้างโฟลเดอร์ถ้ายังไม่มี อัปโหลดไฟล์แอป หน้าเว็บ และไฟล์คงที่ จากนั้นติดตั้งแพ็กเกจใน `requirements.txt` แล้วรีสตาร์ทบริการ

```bat
ssh root@managefile.cayoshibot.com "mkdir -p /root/Web_ManageFile2027"
scp app.py auth_system.py terminal_system.py requirements.txt root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
scp -r static templates root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
ssh root@managefile.cayoshibot.com "/root/Web_ManageFile2027/venv/bin/pip install --upgrade pip && /root/Web_ManageFile2027/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt && sudo systemctl restart my_script.service && sudo systemctl status my_script.service --no-pager && sudo journalctl -u my_script.service -n 50 --no-pager"
```

ถ้าอัปโหลดไฟล์ไว้แล้ว และกำลังอยู่ในเซิร์ฟเวอร์ ให้รันเฉพาะคำสั่งนี้

```bash
/root/Web_ManageFile2027/venv/bin/pip install --upgrade pip && /root/Web_ManageFile2027/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt && sudo systemctl restart my_script.service && sudo systemctl status my_script.service --no-pager && sudo journalctl -u my_script.service -n 50 --no-pager
```

## ติดตั้งครั้งแรกบน Ubuntu

รันครั้งเดียวบนเซิร์ฟเวอร์ หลังจากอัปโหลดไฟล์แล้ว ทำตามลำดับจากบนลงล่าง

ติดตั้ง Python

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip
```

สร้าง virtualenv และติดตั้งแพ็กเกจ

```bash
python3 -m venv /root/Web_ManageFile2027/venv
/root/Web_ManageFile2027/venv/bin/pip install --upgrade pip
/root/Web_ManageFile2027/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt
```

เขียนไฟล์บริการ systemd

```bash
sudo tee /etc/systemd/system/my_script.service > /dev/null << 'EOF'
[Unit]
Description=Web_ManageFile2027
After=network.target

[Service]
User=root
WorkingDirectory=/root/Web_ManageFile2027
ExecStart=/root/Web_ManageFile2027/venv/bin/python3 /root/Web_ManageFile2027/app.py
Restart=always
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF
```

เปิดบริการให้เริ่มเองทุกครั้งที่เปิดเครื่อง และเปิดพอร์ต `2289`

```bash
sudo systemctl daemon-reload
sudo systemctl enable my_script.service
sudo systemctl restart my_script.service
sudo ufw allow 2289/tcp
```

ดูสถานะและบันทึกล่าสุด

```bash
sudo systemctl status my_script.service --no-pager
sudo journalctl -u my_script.service -n 50 --no-pager
```

## Nginx

nginx รับผู้ใช้ที่พอร์ต 80 ของโดเมน `managefile.cayoshibot.com` แล้วส่งต่อไปแอปที่ `127.0.0.1:2289` ผู้ใช้จึงเปิด `http://managefile.cayoshibot.com/` ได้โดยไม่ต้องพิมพ์พอร์ต

- `map` ใช้เปิด WebSocket เมื่อเบราว์เซอร์ขออัปเกรดการเชื่อมต่อ Socket.IO ถ้าเป็นคำขอปกติ จะปิดการเชื่อมต่อพร็อกซีตามปกติ
- `client_max_body_size 0` ไม่จำกัดขนาดไฟล์ที่อัปโหลด
- ส่วนหัว `Upgrade` และ `Connection` ทำให้แชทและการแจ้งความคืบหน้าผ่าน Socket.IO ทำงานได้
- `X-Forwarded-Proto` บอกแอปว่าผู้ใช้เข้ามาด้วย HTTP หรือ HTTPS
- `proxy_buffering off` ส่งข้อมูลต่อทันที ไม่รอสะสมในบัฟเฟอร์
- เวลาอ่านและส่งตั้งไว้ 3600 วินาที เพื่อไม่ให้การอัปโหลดหรือการเชื่อมต่อค้างถูกตัดเร็วเกินไป

ทำบนเซิร์ฟเวอร์หลังจากแอปทำงานที่พอร์ต `2289` แล้ว และ DNS ของ `managefile.cayoshibot.com` ชี้มาที่เครื่องนี้

ติดตั้ง nginx

```bash
sudo apt update
sudo apt install -y nginx
```

เขียนไฟล์คอนฟิกที่ `/etc/nginx/sites-available/managefile.cayoshibot.com`

```bash
sudo tee /etc/nginx/sites-available/managefile.cayoshibot.com > /dev/null << 'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name managefile.cayoshibot.com;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:2289;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
```

เปิดไซต์นี้ ปิดไซต์เริ่มต้น ตรวจไวยากรณ์ แล้วโหลดคอนฟิกใหม่

```bash
sudo ln -sfn /etc/nginx/sites-available/managefile.cayoshibot.com /etc/nginx/sites-enabled/managefile.cayoshibot.com
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx
sudo ufw allow 80/tcp
```

ตรวจว่าเปิด `http://managefile.cayoshibot.com/` ได้ก่อนขอใบรับรอง พอร์ต 80 ต้องเปิดค้างไว้ เพราะ Let's Encrypt ใช้พอร์ตนี้ยืนยันโดเมนและต่ออายุใบรับรอง

## ใบรับรอง HTTPS

ใช้ใบรับรองฟรีจาก Let's Encrypt ผ่าน Certbot ทำหลัง nginx ทำงานแล้ว และ DNS ของ `managefile.cayoshibot.com` ชี้มาที่เครื่องนี้

ติดตั้ง Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo ufw allow 443/tcp
```

ขอใบรับรองและให้ Certbot เขียนคอนฟิก nginx ให้รับ HTTPS พร้อมส่งผู้ใช้จากพอร์ต 80 ไปพอร์ต 443 คำสั่งจะถามอีเมลและให้ยืนยันข้อตกลง

```bash
sudo certbot --nginx -d managefile.cayoshibot.com --redirect
```

Ubuntu ต่ออายุใบรับรองให้อัตโนมัติ ตรวจตัวตั้งเวลา และทดลองต่ออายุโดยยังไม่เปลี่ยนใบรับรองจริง

```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
sudo systemctl status certbot.timer --no-pager
sudo certbot renew --dry-run
```

เปิด `https://managefile.cayoshibot.com/` สร้างบัญชีแรกที่ `https://managefile.cayoshibot.com/setup` ถ้าต้องการข้าม nginx ให้เปิด `http://managefile.cayoshibot.com:2289/`

## ตรวจสอบ

รีสตาร์ทบริการ แล้วดูว่าทำงานอยู่หรือไม่ และอ่านบันทึก 50 บรรทัดล่าสุด

```bash
sudo systemctl restart my_script.service
sudo systemctl status my_script.service --no-pager
sudo journalctl -u my_script.service -n 50 --no-pager
```

เปิด `https://managefile.cayoshibot.com/`
