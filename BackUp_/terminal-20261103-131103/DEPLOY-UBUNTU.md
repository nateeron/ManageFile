# ติดตั้งบน Ubuntu

- โฮสต์: `managefile.cayoshibot.com`
- ไฟล์แอป: `/root/Web_ManageFile2027/app.py`
- พอร์ตของแอป: `2289`
- ที่อยู่เว็บผ่าน nginx: `http://managefile.cayoshibot.com/`
- แอปหลัง nginx: `127.0.0.1:2289`
- virtualenv ของ Python: `/root/venv`
- ชื่อบริการ: `my_script.service`

`app.py` เปิดรับการเชื่อมต่อที่ `0.0.0.0:2289` ทุกคำสั่ง SSH จะถามรหัสผ่านของ `root` คำสั่งเหล่านี้ไม่อัปโหลดทับและไม่ลบ `instance/auth` กับ `ChatHistory` บนเซิร์ฟเวอร์ ดังนั้นบัญชีผู้ใช้และความลับของ JWT ยังอยู่ที่เดิม

## อัปเดตแอป

ใช้เมื่อเซิร์ฟเวอร์ติดตั้งไว้แล้ว และต้องการส่งโค้ดชุดใหม่ขึ้นไป รันในโฟลเดอร์ `G:\M_save\python\ManageFile` บน Windows คำสั่งจะสร้างโฟลเดอร์ถ้ายังไม่มี อัปโหลดไฟล์แอป หน้าเว็บ และไฟล์คงที่ จากนั้นติดตั้งแพ็กเกจใน `requirements.txt` แล้วรีสตาร์ทบริการ

```bat
ssh root@managefile.cayoshibot.com "mkdir -p /root/Web_ManageFile2027"
scp app.py auth_system.py requirements.txt root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
scp -r static templates root@managefile.cayoshibot.com:/root/Web_ManageFile2027/
ssh root@managefile.cayoshibot.com "/root/venv/bin/pip install --upgrade pip && /root/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt && sudo systemctl restart my_script.service && sudo systemctl status my_script.service --no-pager && sudo journalctl -u my_script.service -n 50 --no-pager"
```

ถ้าอัปโหลดไฟล์ไว้แล้ว และกำลังอยู่ในเซิร์ฟเวอร์ ให้รันเฉพาะคำสั่งนี้

```bash
/root/venv/bin/pip install --upgrade pip && /root/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt && sudo systemctl restart my_script.service && sudo systemctl status my_script.service --no-pager && sudo journalctl -u my_script.service -n 50 --no-pager
```

## ติดตั้งครั้งแรกบน Ubuntu

รันครั้งเดียวบนเซิร์ฟเวอร์ หลังจากอัปโหลดไฟล์แล้ว คำสั่งนี้ติดตั้ง Python, สร้าง virtualenv ที่ `/root/venv`, ติดตั้งแพ็กเกจ, เขียนไฟล์บริการ systemd, สั่งให้บริการเริ่มเองทุกครั้งที่เปิดเครื่อง, เปิดพอร์ต `2289` และแสดงสถานะกับบันทึกล่าสุด

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip && python3 -m venv /root/venv && /root/venv/bin/pip install --upgrade pip && /root/venv/bin/pip install -r /root/Web_ManageFile2027/requirements.txt && printf '%s\n' '[Unit]' 'Description=ManageFile' 'After=network.target' '' '[Service]' 'User=root' 'WorkingDirectory=/root/Web_ManageFile2027' 'ExecStart=/root/venv/bin/python3 /root/Web_ManageFile2027/app.py' 'Restart=always' 'Environment=PYTHONUNBUFFERED=1' '' '[Install]' 'WantedBy=multi-user.target' | sudo tee /etc/systemd/system/my_script.service && sudo systemctl daemon-reload && sudo systemctl enable my_script.service && sudo systemctl restart my_script.service && sudo ufw allow 2289/tcp && sudo systemctl status my_script.service --no-pager && sudo journalctl -u my_script.service -n 50 --no-pager
```

## Nginx

nginx รับผู้ใช้ที่พอร์ต 80 ของโดเมน `managefile.cayoshibot.com` แล้วส่งต่อไปแอปที่ `127.0.0.1:2289` ผู้ใช้จึงเปิด `http://managefile.cayoshibot.com/` ได้โดยไม่ต้องพิมพ์พอร์ต

- `map` ใช้เปิด WebSocket เมื่อเบราว์เซอร์ขออัปเกรดการเชื่อมต่อ Socket.IO ถ้าเป็นคำขอปกติ จะปิดการเชื่อมต่อพร็อกซีตามปกติ
- `client_max_body_size 0` ไม่จำกัดขนาดไฟล์ที่อัปโหลด
- ส่วนหัว `Upgrade` และ `Connection` ทำให้แชทและการแจ้งความคืบหน้าผ่าน Socket.IO ทำงานได้
- `X-Forwarded-Proto` บอกแอปว่าผู้ใช้เข้ามาด้วย HTTP หรือ HTTPS
- `proxy_buffering off` ส่งข้อมูลต่อทันที ไม่รอสะสมในบัฟเฟอร์
- เวลาอ่านและส่งตั้งไว้ 3600 วินาที เพื่อไม่ให้การอัปโหลดหรือการเชื่อมต่อค้างถูกตัดเร็วเกินไป

ไฟล์คอนฟิกอยู่ที่ `/etc/nginx/sites-available/managefile.cayoshibot.com`

```nginx
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
```

คำสั่งนี้ติดตั้ง nginx, เขียนคอนฟิก, เปิดไซต์, ตรวจไวยากรณ์, โหลดคอนฟิกใหม่ และเปิดพอร์ต 80

```bash
sudo apt update && sudo apt install -y nginx && sudo tee /etc/nginx/sites-available/managefile.cayoshibot.com > /dev/null << 'EOF'
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
sudo ln -sfn /etc/nginx/sites-available/managefile.cayoshibot.com /etc/nginx/sites-enabled/managefile.cayoshibot.com && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl enable nginx && sudo systemctl reload nginx && sudo ufw allow 80/tcp
```

เปิด `http://managefile.cayoshibot.com/` สร้างบัญชีแรกที่ `http://managefile.cayoshibot.com/setup` ถ้าต้องการข้าม nginx ให้เปิด `http://managefile.cayoshibot.com:2289/`

## ตรวจสอบ

รีสตาร์ทบริการ แล้วดูว่าทำงานอยู่หรือไม่ และอ่านบันทึก 50 บรรทัดล่าสุด

```bash
sudo systemctl restart my_script.service
sudo systemctl status my_script.service --no-pager
sudo journalctl -u my_script.service -n 50 --no-pager
```

เปิด `http://managefile.cayoshibot.com/`
