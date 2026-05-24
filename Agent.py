import os
import time
import platform
import psutil
import requests
from requests.exceptions import RequestException

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
SERVER_ID = int(os.getenv("SERVER_ID", "2"))
SOURCE = os.getenv("SOURCE", f"server_{SERVER_ID}")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
PUSH_INTERVAL_SECONDS = float(os.getenv("PUSH_INTERVAL_SECONDS", "2"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "10"))

EFFECTIVE_ADMIN_TOKEN = ADMIN_TOKEN


def check_backend_connection() -> bool:
    try:
        response = requests.get(f"{BACKEND_URL}/api/health", timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        print(f"[OK] Connected to backend: {BACKEND_URL}")
        return True
    except RequestException as exc:
        print(f"[ERROR] Cannot connect to backend {BACKEND_URL}: {exc}")
        print("[HINT] Set BACKEND_URL, e.g. http://localhost:8000 or your server URL")
        return False


def resolve_admin_token() -> str:
    global EFFECTIVE_ADMIN_TOKEN

    if EFFECTIVE_ADMIN_TOKEN:
        return EFFECTIVE_ADMIN_TOKEN

    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        return ""

    try:
        response = requests.post(
            f"{BACKEND_URL}/api/auth/login",
            json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
            timeout=REQUEST_TIMEOUT_SECONDS
        )

        if response.status_code >= 400:
            print(f"[WARN] Admin login failed ({response.status_code}): {response.text[:200]}")
            return ""

        token = response.json().get("access_token", "")
        if not token:
            print("[WARN] Admin login succeeded but access_token is missing in response.")
            return ""

        EFFECTIVE_ADMIN_TOKEN = token
        print(f"[OK] Obtained admin token using ADMIN_USERNAME={ADMIN_USERNAME}")
        return EFFECTIVE_ADMIN_TOKEN
    except RequestException as exc:
        print(f"[WARN] Admin login request failed: {exc}")
        return ""


def update_hardware_info():
    cpu_cores = int(psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True) or 1)
    ram_gb = max(1, int(round(psutil.virtual_memory().total / (1024 ** 3))))

    payload = {
        "cpu_cores": cpu_cores,
        "ram_gb": ram_gb,
        "os_type": platform.system()
    }

    token = resolve_admin_token()
    if not token:
        print("[WARN] No admin token available. Skipping hardware update (cpu_cores/ram_gb/os_type).")
        print("[HINT] Set ADMIN_TOKEN or set ADMIN_USERNAME + ADMIN_PASSWORD so agent can auto-create server record.")
        return

    headers = {"Authorization": f"Bearer {token}"}

    def create_server_if_missing() -> bool:
        create_params = {
            "name": f"Server {SERVER_ID}",
            "specs": f"Remote Server - {payload['os_type']}",
            "cpu_cores": int(payload["cpu_cores"]),
            "ram_gb": max(1, int(round(payload["ram_gb"]))),
            "os_type": payload["os_type"],
            "price_per_hour": 0
        }

        try:
            create_response = requests.post(
                f"{BACKEND_URL}/api/servers/admin/servers",
                params=create_params,
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS
            )

            if create_response.status_code >= 400:
                print(f"[WARN] Auto-create server failed ({create_response.status_code}): {create_response.text[:200]}")
                return False

            print(f"[OK] Auto-created server record for SERVER_ID={SERVER_ID}")
            return True
        except RequestException as exc:
            print(f"[WARN] Auto-create server request failed: {exc}")
            return False

    try:
        response = requests.patch(
            f"{BACKEND_URL}/api/servers/admin/servers/{SERVER_ID}",
            json=payload,
            headers=headers,
            timeout=REQUEST_TIMEOUT_SECONDS
        )

        if response.status_code == 404:
            print(f"[INFO] Server ID {SERVER_ID} not found in available_servers. Creating it now...")
            if create_server_if_missing():
                # Retry hardware update once after auto-create
                retry = requests.patch(
                    f"{BACKEND_URL}/api/servers/admin/servers/{SERVER_ID}",
                    json=payload,
                    headers=headers,
                    timeout=REQUEST_TIMEOUT_SECONDS
                )

                if retry.status_code >= 400:
                    print(f"[WARN] Hardware update retry failed ({retry.status_code}): {retry.text[:200]}")
                else:
                    print(f"[OK] Hardware info updated for server_id={SERVER_ID}")
        elif response.status_code >= 400:
            print(f"[WARN] Hardware update failed ({response.status_code}): {response.text[:200]}")
        else:
            print(f"[OK] Hardware info updated for server_id={SERVER_ID}")
    except RequestException as exc:
        print(f"[WARN] Hardware update request failed: {exc}")


def push_metric(metric_type, value):
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/metrics",
            json={"metric_type": metric_type, "value": float(value), "source": SOURCE},
            timeout=REQUEST_TIMEOUT_SECONDS
        )

        if response.status_code >= 400:
            print(f"[WARN] Push {metric_type} failed ({response.status_code}): {response.text[:200]}")
    except RequestException as exc:
        print(f"[WARN] Push {metric_type} failed: {exc}")


def run_loop():
    print(f"[INFO] Starting metric loop: source={SOURCE}, interval={PUSH_INTERVAL_SECONDS}s")
    sent_count = 0

    while True:
        cpu = psutil.cpu_percent(interval=0.2)
        mem = psutil.virtual_memory().percent

        push_metric("cpu", cpu)
        push_metric("memory", mem)

        sent_count += 1
        if sent_count % 5 == 0:
            print(f"[INFO] Sent {sent_count * 2} metrics | CPU={cpu:.2f}% MEM={mem:.2f}%")

        time.sleep(PUSH_INTERVAL_SECONDS)


if __name__ == "__main__":
    print("=" * 60)
    print("REMOTE AGENT START")
    print("=" * 60)
    print(f"BACKEND_URL={BACKEND_URL}")
    print(f"SERVER_ID={SERVER_ID}")
    print(f"SOURCE={SOURCE}")
    print(f"ADMIN_TOKEN_SET={'yes' if bool(ADMIN_TOKEN) else 'no'}")
    print(f"ADMIN_USERNAME_SET={'yes' if bool(ADMIN_USERNAME) else 'no'}")
    print(f"ADMIN_PASSWORD_SET={'yes' if bool(ADMIN_PASSWORD) else 'no'}")

    if not check_backend_connection():
        raise SystemExit(1)

    update_hardware_info()
    run_loop()
