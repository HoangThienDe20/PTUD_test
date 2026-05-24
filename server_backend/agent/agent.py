"""
Agent mẫu cho VPS con.
Nhiệm vụ:
1) Register server
2) Gửi metrics mỗi 5 giây
3) Poll task và thực thi create/delete ssh user
4) Báo kết quả task về VPS trung tâm
"""

import os
import platform
import subprocess
import time
from datetime import datetime

import psutil
import requests

CENTER_URL = os.getenv("CENTER_URL", "http://13.75.54.112:8000")
METRICS_TOKEN = os.getenv("METRICS_TOKEN", "demo-secret-token")

SERVER_ID = os.getenv("SERVER_ID", "vps-ubuntu-01")
SERVER_NAME = os.getenv("SERVER_NAME", SERVER_ID)

HEADERS = {"X-Metrics-Token": METRICS_TOKEN}


def _run(cmd: str):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def create_ssh_user(username: str, public_key: str):
    _run(f"id -u {username} || useradd -m -s /bin/bash {username}")
    _run(f"mkdir -p /home/{username}/.ssh")
    _run(f"echo '{public_key}' > /home/{username}/.ssh/authorized_keys")
    _run(f"chown -R {username}:{username} /home/{username}/.ssh")
    _run(f"chmod 700 /home/{username}/.ssh")
    _run(f"chmod 600 /home/{username}/.ssh/authorized_keys")


def delete_ssh_user(username: str):
    _run(f"id -u {username} && userdel -r {username} || true")


def register_server():
    payload = {
        "server_id": SERVER_ID,
        "name": SERVER_NAME,
        "ip": "",
        "cpu_cores": psutil.cpu_count(logical=True),
        "cpu_physical_cores": psutil.cpu_count(logical=False) or 0,
        "ram_total_gb": round(psutil.virtual_memory().total / (1024**3), 3),
        "os": platform.platform(),
        "architecture": platform.machine(),
        "note": "agent-register",
    }
    r = requests.post(f"{CENTER_URL}/api/servers/register", json=payload, headers=HEADERS, timeout=15)
    print("Register:", r.status_code, r.text)


def push_metrics():
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")
    payload = {
        "server_id": SERVER_ID,
        "cpu": psutil.cpu_percent(interval=1),
        "ram": vm.percent,
        "disk": du.percent,
        "ram_used_gb": round(vm.used / (1024**3), 3),
        "ram_available_gb": round(vm.available / (1024**3), 3),
        "uptime": datetime.utcnow().isoformat(),
    }
    r = requests.post(f"{CENTER_URL}/api/metrics", json=payload, headers=HEADERS, timeout=15)
    print("Metric:", r.status_code)


def poll_task():
    r = requests.get(f"{CENTER_URL}/api/agent/tasks/{SERVER_ID}", headers=HEADERS, timeout=15)
    data = r.json()
    task = data.get("task")
    if not task:
        return

    task_id = task["task_id"]
    action = task.get("action")
    username = task.get("username")
    public_key = task.get("public_key") or ""

    status = "success"
    message = "ok"
    try:
        if action == "create_ssh_user":
            create_ssh_user(username=username, public_key=public_key)
        elif action == "delete_ssh_user":
            delete_ssh_user(username=username)
        else:
            status = "failed"
            message = f"Unknown action: {action}"
    except Exception as exc:
        status = "failed"
        message = str(exc)

    requests.post(
        f"{CENTER_URL}/api/agent/tasks/{task_id}/result",
        json={"status": status, "message": message},
        headers=HEADERS,
        timeout=15,
    )


def main():
    while True:
        try:
            register_server()
            break
        except Exception as exc:
            print("Register error:", exc)
            time.sleep(3)

    while True:
        try:
            push_metrics()
            poll_task()
        except Exception as exc:
            print("Loop error:", exc)
        time.sleep(5)


if __name__ == "__main__":
    main()
