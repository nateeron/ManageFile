โปรแกรม จัดการไฟร์
- สามารถภ่ายโอนไฟร์ได้สดวก รวดเร็ว
- เข้าถึงไฟร์ สามารถ Download Upload File Folder show image zoom and play video

RUN
python -m flask run --host=0.0.0.0 --port=1298 --debug



*** Ubuntu ***
sudo nano /etc/systemd/system/my_script.service
--------------------------------------------------
[Unit]
Description=My Python Script Service
After=network.target

[Service]
User=root
WorkingDirectory=/root/Python_App_ManageFile
ExecStart=/root/myenv/bin/python /root/Python_App_ManageFile/app.py
Restart=always
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
--------------------------------------------------
sudo systemctl daemon-reload
sudo systemctl enable my_script.service
sudo systemctl start my_script.service
sudo systemctl restart my_script.service

sudo systemctl status my_script.service
sudo journalctl -u my_script.service -n 50
--------------------------------------------------------
Success...
root@Tset:~# sudo systemctl daemon-reload
root@Tset:~# sudo systemctl restart my_script.service
root@Tset:~# sudo systemctl status my_script.service
● my_script.service - My Python Script Service
     Loaded: loaded (/etc/systemd/system/my_script.service; enabled; preset: enabled)
     Active: active (running) since Thu 2025-04-03 17:55:36 UTC; 3s ago
 Invocation: 478aed18cb26405db4b563d5ae311df4
   Main PID: 23767 (python)
      Tasks: 1 (limit: 1009)
     Memory: 25.8M (peak: 26.1M)
        CPU: 323ms
     CGroup: /system.slice/my_script.service
             └─23767 /root/myenv/bin/python /root/Python_App_ManageFile/app.py

Apr 03 17:55:36 Tset systemd[1]: Started my_script.service - My Python Script Service.
Apr 03 17:55:36 Tset python[23767]: Werkzeug appears to be used in a production deployment. Consider switching to a production web server instead.
Apr 03 17:55:36 Tset python[23767]:  * Serving Flask app 'app'
Apr 03 17:55:36 Tset python[23767]:  * Debug mode: off
Apr 03 17:55:36 Tset python[23767]: WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.
Apr 03 17:55:36 Tset python[23767]:  * Running on all addresses (0.0.0.0)
Apr 03 17:55:36 Tset python[23767]:  * Running on http://127.0.0.1:1234
Apr 03 17:55:36 Tset python[23767]:  * Running on http://45.76.184.5:1234
Apr 03 17:55:36 Tset python[23767]: Press CTRL+C to quit
-------------------------------------------------------------------------------
*** END Ubuntu ***



****************************************************************************************************************************************************************
ssh-keygen -R 45.76.184.5 :Clear

ssh root@45.76.184.5

Cw2!Xf}qSy_Y}$73
****************************************************************************************************************************************************************
1-sudo apt update && sudo apt install -y openssh-server && echo y | apt install python3.12-venv && sudo apt update && sudo apt upgrade -y && python3 -m venv venv && source venv/bin/activate && pip install flask && pip install flask-socketio && pip install pillow
*2-python3 -m venv venv
*3-echo y | apt install python3.12-venv
*4-sudo apt update && sudo apt upgrade -y
*5-python3 -m venv venv
*6-source venv/bin/activate
*7-pip install flask && pip install flask-socketio && pip install pillow
8-scp -r G:\M_save\python\ManageFile root@45.76.184.5:ManageFile
*9-which python3
10-sudo nano /etc/systemd/system/my_script.service
--------------------------------------------------
[Unit]
Description=My Python Script Service
After=network.target

[Service]
User=root
WorkingDirectory=/root/ManageFile
ExecStart=/root/venv/bin/python3 /root/ManageFile/app.py
Restart=always
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
--------------------------------------------------
11-sudo systemctl daemon-reload && sudo systemctl enable my_script.service && sudo systemctl start my_script.service && sudo systemctl status my_script.service && sudo ufw allow 1298 && sudo journalctl -u my_script.service -n 50

*12-sudo journalctl -u my_script.service -n 50
*13-sudo ufw allow 1298
****************************************************************************************************************************************************************


1-sudo apt update && sudo apt install -y openssh-server && echo y | apt install python3.12-venv && sudo apt update && sudo apt upgrade -y && python3 -m venv venv && source venv/bin/activate && pip install flask && pip install flask-socketio && pip install pillow && echo -e "[Unit]\nDescription=My Python Script Service\nAfter=network.target\n\n[Service]\nUser=root\nWorkingDirectory=/root/ManageFile\nExecStart=/root/venv/bin/python3 /root/ManageFile/app.py\nRestart=always\nEnvironment=\"PYTHONUNBUFFERED=1\"\n\n[Install]\nWantedBy=multi-user.target" | sudo tee /etc/systemd/system/my_script.service && sudo systemctl daemon-reload && sudo systemctl enable my_script.service && sudo systemctl start my_script.service && sudo systemctl status my_script.service && sudo ufw allow 1298 && sudo journalctl -u my_script.service -n 50


