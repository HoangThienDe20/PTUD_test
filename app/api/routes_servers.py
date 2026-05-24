"""Server management routes backed by remote server rental flow."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.api.routes_auth import get_current_user
from app.system_metrics import SystemMetricsCollector
from app.config import METRICS_CENTRAL_BASE_URL, METRICS_CENTRAL_ADMIN_TOKEN
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
import json
import random
import time
import threading


# ============== REQUEST MODELS ==============
class ServerUpdateRequest(BaseModel):
    name: Optional[str] = None
    specs: Optional[str] = None
    price_per_month: Optional[float] = None
    # Backward compatibility
    price_per_hour: Optional[float] = None
    cpu_cores: Optional[int] = None
    ram_gb: Optional[int] = None
    os_type: Optional[str] = None
    
    class Config:
        from_attributes = True


router = APIRouter(prefix="/api/servers", tags=["servers"])

_rent_lock = threading.Lock()
_rent_challenges = {}
_user_rentals = {}


def _raise_legacy_subscription_deprecated() -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "Legacy server subscription approval flow has been removed. "
            "Use /api/servers/rent/request and /api/servers/rent/confirm instead."
        ),
    )


def _fetch_remote_servers():
    url = f"{METRICS_CENTRAL_BASE_URL.rstrip('/')}/api/servers"
    req = urlrequest.Request(url, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=10) as resp:
            payload = resp.read().decode("utf-8")
            data = json.loads(payload)
            if not isinstance(data, list):
                return []
            return data
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch remote servers: {str(exc)}"
        )


def _get_remote_server_by_id(server_id: str) -> Optional[dict]:
    servers = _fetch_remote_servers()
    for s in servers:
        if str(s.get("server_id")) == str(server_id):
            return s
    return None


def _remote_json_request(method: str, path: str, payload: Optional[dict] = None, headers: Optional[dict] = None):
    url = f"{METRICS_CENTRAL_BASE_URL.rstrip('/')}{path}"
    body = None
    merged_headers = {"Content-Type": "application/json"}
    if headers:
        merged_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=body, headers=merged_headers, method=method)
    try:
        with urlrequest.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        detail = f"Remote API error HTTP {exc.code}"
        try:
            err = json.loads(exc.read().decode("utf-8"))
            if isinstance(err, dict) and err.get("detail"):
                detail = err["detail"]
        except Exception:
            pass
        raise HTTPException(status_code=exc.code if exc.code < 500 else status.HTTP_502_BAD_GATEWAY, detail=detail)
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to connect remote API: {str(exc)}")


def _fetch_remote_server_history(server_id: str):
    url = f"{METRICS_CENTRAL_BASE_URL.rstrip('/')}/api/metrics/history?{urlencode({'server_id': server_id})}"
    req = urlrequest.Request(url, method="GET")
    try:
        with urlrequest.urlopen(req, timeout=10) as resp:
            payload = resp.read().decode("utf-8")
            data = json.loads(payload)
            if not isinstance(data, list):
                return []
            return data
    except HTTPError as exc:
        if exc.code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Server not found on metrics central API"
            )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch remote server history: HTTP {exc.code}"
        )
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch remote server history: {str(exc)}"
        )


def _fetch_remote_rentals():
    return _remote_json_request(
        "GET",
        "/api/rentals",
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )


def _normalize_remote_server(item: dict):
    server_id = item.get("server_id")
    normalized_id = str(server_id) if server_id is not None else str(item.get("name", "unknown"))
    return {
        "id": normalized_id,
        "server_id": normalized_id,
        "name": item.get("display_name") or item.get("name") or normalized_id,
        "raw_name": item.get("name"),
        "specs": item.get("note") or (f"IP: {item.get('ip')}" if item.get("ip") else "Remote metrics source"),
        "specifications": item.get("specifications"),
        "description": item.get("description"),
        "cpu_cores": item.get("cpu_cores"),
        "cpu_physical_cores": item.get("cpu_physical_cores"),
        "ram_total_gb": item.get("ram_total_gb"),
        "ram_gb": item.get("ram_total_gb"),
        "os_type": item.get("os"),
        "os": item.get("os"),
        "architecture": item.get("architecture"),
        "is_available": bool(item.get("is_available", True)),
        "price_per_month": float(item.get("price_per_month") or 0),
        "price_per_hour": 0.0,  # Kept for frontend backward compatibility
        "subscribers_count": 0,
        "created_at": item.get("registered_at") or item.get("last_updated"),
        "registered_at": item.get("registered_at"),
        "metadata_updated_at": item.get("metadata_updated_at"),
        "cpu": item.get("cpu"),
        "ram": item.get("ram"),
        "disk": item.get("disk"),
        "ram_used_gb": item.get("ram_used_gb"),
        "ram_available_gb": item.get("ram_available_gb"),
        "uptime": item.get("uptime"),
        "ip": item.get("ip"),
        "status": item.get("status", "unknown"),
        "last_seen": item.get("last_seen"),
        "last_updated": item.get("last_updated"),
        "rented": item.get("rented", False),
    }


def _is_rental_visible_for_user(rental: dict, user: User) -> bool:
    return rental.get("user_id") == user.id or user.role == "admin"


def _serialize_rental_for_user(rental: dict, user: User):
    show_secret = user.role == "admin" or rental.get("user_id") == user.id
    return {
        "rental_id": rental.get("rental_id"),
        "server_id": rental.get("server_id"),
        "status": rental.get("status"),
        "created_at": rental.get("created_at"),
        "activated_at": rental.get("activated_at"),
        "cancelled_at": rental.get("cancelled_at"),
        "ip": rental.get("ip"),
        "port": rental.get("port"),
        "username": rental.get("username"),
        "ssh_command": rental.get("ssh_command"),
        "private_key_filename": rental.get("private_key_filename"),
        # Re-download is allowed with verification code.
        "private_key_available": show_secret and bool(rental.get("private_key")),
    }


class RentRequestBody(BaseModel):
    server_id: Optional[str] = None


class RentConfirmBody(BaseModel):
    challenge_id: str
    code: str


class CancelRentalBody(BaseModel):
    rental_id: str


class SecureActionRequestBody(BaseModel):
    rental_id: str


class SecureActionConfirmBody(BaseModel):
    challenge_id: str
    code: str


def _serialize_remote_rental_for_user(rental: dict, user: User):
    rental_id = rental.get("rental_id")
    with _rent_lock:
        local_record = _user_rentals.get(rental_id, {})
    renter_name = rental.get("renter_name") or local_record.get("creator_username")
    return {
        "rental_id": rental_id,
        "server_id": rental.get("server_id"),
        "renter_name": renter_name,
        "status": rental.get("status"),
        "created_at": rental.get("created_at"),
        "activated_at": rental.get("activated_at"),
        "cancelled_at": rental.get("cancelled_at"),
        "ip": rental.get("server_ip"),
        "port": 22,
        "username": rental.get("username"),
        "ssh_command": local_record.get("ssh_command"),
        "private_key_filename": local_record.get("private_key_filename"),
        # Re-download is allowed with verification code.
        "private_key_available": bool(local_record.get("private_key")),
    }


@router.get("/{server_id}/history")
async def get_server_history(server_id: str):
    """Proxy server history from Metrics Central API."""
    history = _fetch_remote_server_history(server_id)
    return {
        "server_id": server_id,
        "history": history,
        "count": len(history),
    }


@router.post("/rent/request")
async def request_rent_code(
    body: RentRequestBody,
    current_user: User = Depends(get_current_user),
):
    """Create a 6-digit verification code before renting a server."""
    server_id = body.server_id
    if not server_id:
        raise HTTPException(status_code=422, detail="server_id is required")

    challenge_id = f"challenge_{random.randint(100000, 999999)}_{int(time.time())}"
    code = f"{random.randint(0, 999999):06d}"

    with _rent_lock:
        _rent_challenges[challenge_id] = {
            "challenge_id": challenge_id,
            "server_id": server_id,
            "user_id": current_user.id,
            "code": code,
            "created_at": time.time(),
            "expires_at": time.time() + 300,
            "used": False,
        }

    return {
        "challenge_id": challenge_id,
        "server_id": server_id,
        "verification_code": code,
        "expires_in_seconds": 300,
    }


@router.post("/rent/confirm")
async def confirm_rent(
    body: RentConfirmBody,
    current_user: User = Depends(get_current_user),
):
    """Validate code and create rental via central backend."""
    with _rent_lock:
        challenge = _rent_challenges.get(body.challenge_id)
        if not challenge:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if challenge["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Challenge does not belong to current user")
        if challenge["used"]:
            raise HTTPException(status_code=400, detail="Challenge already used")
        if challenge["expires_at"] < time.time():
            raise HTTPException(status_code=400, detail="Challenge expired")
        if str(body.code).strip() != challenge["code"]:
            raise HTTPException(status_code=400, detail="Invalid verification code")

        challenge["used"] = True
        server_id = challenge["server_id"]

    payload = {
        "server_id": server_id,
        "renter_name": current_user.username,
    }
    remote = _remote_json_request(
        "POST",
        "/api/rentals/create",
        payload=payload,
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )

    rental_id = remote.get("rental_id")
    if not rental_id:
        raise HTTPException(status_code=500, detail="Remote rental response missing rental_id")

    record = {
        "rental_id": rental_id,
        "user_id": current_user.id,
        "creator_username": current_user.username,
        "server_id": remote.get("server_id") or server_id,
        "status": "active" if remote.get("message") == "VPS rented successfully" else remote.get("status", "pending"),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "activated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) if remote.get("message") == "VPS rented successfully" else None,
        "ip": remote.get("ip"),
        "port": remote.get("port", 22),
        "username": remote.get("username"),
        "private_key_filename": remote.get("private_key_filename"),
        "private_key": remote.get("private_key"),
        "ssh_command": remote.get("ssh_command"),
        "private_key_downloaded": False,
    }

    with _rent_lock:
        _user_rentals[rental_id] = record

    return _serialize_rental_for_user(record, current_user)


@router.get("/my-rentals")
async def get_my_rentals(current_user: User = Depends(get_current_user)):
    remote_items = _fetch_remote_rentals()
    if not isinstance(remote_items, list):
        remote_items = []
    mine = [r for r in remote_items if r.get("renter_name") == current_user.username]
    return {
        "rentals": [_serialize_remote_rental_for_user(r, current_user) for r in mine],
        "total": len(mine),
    }


@router.get("/rentals")
async def get_all_rentals(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can perform this action")
    items = _fetch_remote_rentals()
    if not isinstance(items, list):
        items = []
    return {
        "rentals": [_serialize_remote_rental_for_user(r, current_user) for r in items],
        "total": len(items),
    }


@router.get("/rentals/{rental_id}/private-key")
async def get_private_key_once(rental_id: str, current_user: User = Depends(get_current_user)):
    with _rent_lock:
        rental = _user_rentals.get(rental_id)
        if not rental:
            raise HTTPException(status_code=404, detail="Rental not found")
        if rental.get("user_id") != current_user.id and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Not allowed")
        if rental.get("private_key_downloaded"):
            raise HTTPException(status_code=410, detail="Private key can only be downloaded once")
        private_key = rental.get("private_key")
        if not private_key:
            raise HTTPException(status_code=404, detail="Private key is not available")
        rental["private_key_downloaded"] = True
    return {
        "rental_id": rental_id,
        "private_key_filename": rental.get("private_key_filename"),
        "private_key": private_key,
    }


@router.post("/rentals/private-key/request")
async def request_private_key_code(
    body: SecureActionRequestBody,
    current_user: User = Depends(get_current_user),
):
    with _rent_lock:
        rental = _user_rentals.get(body.rental_id)
        if not rental:
            raise HTTPException(status_code=404, detail="Rental not found")
        if rental.get("user_id") != current_user.id and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Not allowed")

    challenge_id = f"challenge_key_{random.randint(100000, 999999)}_{int(time.time())}"
    code = f"{random.randint(0, 999999):06d}"
    with _rent_lock:
        _rent_challenges[challenge_id] = {
            "challenge_id": challenge_id,
            "action": "download_private_key",
            "rental_id": body.rental_id,
            "user_id": current_user.id,
            "code": code,
            "created_at": time.time(),
            "expires_at": time.time() + 300,
            "used": False,
        }

    return {
        "challenge_id": challenge_id,
        "verification_code": code,
        "expires_in_seconds": 300,
    }


@router.post("/rentals/private-key/confirm")
async def confirm_private_key_download(
    body: SecureActionConfirmBody,
    current_user: User = Depends(get_current_user),
):
    with _rent_lock:
        challenge = _rent_challenges.get(body.challenge_id)
        if not challenge:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if challenge.get("action") != "download_private_key":
            raise HTTPException(status_code=400, detail="Invalid challenge action")
        if challenge["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Challenge does not belong to current user")
        if challenge["used"]:
            raise HTTPException(status_code=400, detail="Challenge already used")
        if challenge["expires_at"] < time.time():
            raise HTTPException(status_code=400, detail="Challenge expired")
        if str(body.code).strip() != challenge["code"]:
            raise HTTPException(status_code=400, detail="Invalid verification code")

        challenge["used"] = True
        rental = _user_rentals.get(challenge["rental_id"])
        if not rental:
            raise HTTPException(status_code=404, detail="Rental not found")
        private_key = rental.get("private_key")
        if not private_key:
            raise HTTPException(status_code=404, detail="Private key is not available")

        # Keep backward compatibility with existing one-time flag.
        rental["private_key_downloaded"] = True

    return {
        "rental_id": rental.get("rental_id"),
        "private_key_filename": rental.get("private_key_filename"),
        "private_key": private_key,
    }


@router.post("/rentals/cancel/request")
async def request_cancel_rental_code(
    body: SecureActionRequestBody,
    current_user: User = Depends(get_current_user),
):
    remote_items = _fetch_remote_rentals()
    if not isinstance(remote_items, list):
        remote_items = []
    rental = next((r for r in remote_items if r.get("rental_id") == body.rental_id), None)
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    if current_user.role != "admin" and rental.get("renter_name") != current_user.username:
        raise HTTPException(status_code=403, detail="Not allowed")

    challenge_id = f"challenge_cancel_{random.randint(100000, 999999)}_{int(time.time())}"
    code = f"{random.randint(0, 999999):06d}"
    with _rent_lock:
        _rent_challenges[challenge_id] = {
            "challenge_id": challenge_id,
            "action": "cancel_rental",
            "rental_id": body.rental_id,
            "user_id": current_user.id,
            "code": code,
            "created_at": time.time(),
            "expires_at": time.time() + 300,
            "used": False,
        }
    return {
        "challenge_id": challenge_id,
        "verification_code": code,
        "expires_in_seconds": 300,
    }


@router.post("/rentals/cancel/confirm")
async def confirm_cancel_rental(
    body: SecureActionConfirmBody,
    current_user: User = Depends(get_current_user),
):
    with _rent_lock:
        challenge = _rent_challenges.get(body.challenge_id)
        if not challenge:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if challenge.get("action") != "cancel_rental":
            raise HTTPException(status_code=400, detail="Invalid challenge action")
        if challenge["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Challenge does not belong to current user")
        if challenge["used"]:
            raise HTTPException(status_code=400, detail="Challenge already used")
        if challenge["expires_at"] < time.time():
            raise HTTPException(status_code=400, detail="Challenge expired")
        if str(body.code).strip() != challenge["code"]:
            raise HTTPException(status_code=400, detail="Invalid verification code")
        challenge["used"] = True
        rental_id = challenge["rental_id"]

    remote = _remote_json_request(
        "POST",
        f"/api/rentals/{rental_id}/cancel",
        payload={},
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )

    with _rent_lock:
        local_rental = _user_rentals.get(rental_id)
        if local_rental:
            local_rental["status"] = remote.get("status", "cancelled")
            local_rental["cancelled_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    return {"message": remote.get("message", "Rental cancelled"), "rental_id": rental_id, "status": remote.get("status", "cancelled")}


@router.post("/rentals/cancel")
async def cancel_rental(
    body: CancelRentalBody,
    current_user: User = Depends(get_current_user),
):
    remote_items = _fetch_remote_rentals()
    if not isinstance(remote_items, list):
        remote_items = []
    rental = next((r for r in remote_items if r.get("rental_id") == body.rental_id), None)
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    if current_user.role != "admin" and rental.get("renter_name") != current_user.username:
        raise HTTPException(status_code=403, detail="Not allowed")

    remote = _remote_json_request(
        "POST",
        f"/api/rentals/{body.rental_id}/cancel",
        payload={},
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )

    with _rent_lock:
        local_rental = _user_rentals.get(body.rental_id)
        if local_rental:
            local_rental["status"] = remote.get("status", "cancelled")
            local_rental["cancelled_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    return {"message": remote.get("message", "Rental cancelled"), "rental_id": body.rental_id, "status": remote.get("status", "cancelled")}


def verify_admin(user: User = Depends(get_current_user)) -> User:
    """Verify that current user is admin"""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can perform this action"
        )
    return user


# ============== ADMIN: CREATE & MANAGE SERVERS ==============

@router.post("/admin/servers", dependencies=[Depends(verify_admin)])
async def create_server(
    name: str,
    specs: str,
    cpu_cores: int,
    ram_gb: int,
    os_type: str = "Ubuntu",
    price_per_hour: float = 0.0,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """[ADMIN] Deprecated in remote-monitoring mode. Servers are registered by remote agents."""
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Server creation is managed by Metrics Central agent registration (/api/servers/register)."
    )


@router.get("/admin/servers", dependencies=[Depends(verify_admin)])
async def get_all_servers(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """[ADMIN] Get all servers"""
    remote_servers = _fetch_remote_servers()
    server_list = [_normalize_remote_server(s) for s in remote_servers]
    return {
        "servers": server_list,
        "total": len(server_list)
    }


@router.delete("/admin/servers/{server_id}", dependencies=[Depends(verify_admin)])
async def delete_server(
    server_id: str,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """[ADMIN] Deprecated in remote-monitoring mode."""
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Server deletion is not exposed by Metrics Central API."
    )


# ============== USER: BROWSE & SUBSCRIBE TO SERVERS ==============

@router.get("")
async def get_available_servers(db: Session = Depends(get_db)):
    """Get all available servers that users can subscribe to"""
    remote_servers = _fetch_remote_servers()
    server_list = [_normalize_remote_server(s) for s in remote_servers]

    return {
        "servers": server_list,
        "total": len(server_list)
    }


@router.get("/{server_id}/subscribers")
async def get_server_subscribers(
    server_id: int,
    db: Session = Depends(get_db)
):
    """Get renters for a server from Metrics Central rentals."""
    remote_items = _fetch_remote_rentals()
    if not isinstance(remote_items, list):
        remote_items = []
    matched = [r for r in remote_items if str(r.get("server_id")) == str(server_id)]
    return {
        "subscribers": [
            {
                "renter_name": r.get("renter_name"),
                "username": r.get("username"),
                "status": r.get("status"),
                "created_at": r.get("created_at"),
                "activated_at": r.get("activated_at"),
                "cancelled_at": r.get("cancelled_at"),
            }
            for r in matched
        ],
        "total": len(matched)
    }


@router.post("/{server_id}/subscribe")
async def subscribe_to_server(
    server_id: str,
    subscription_duration_months: int = 1,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deprecated local subscription endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


@router.delete("/{server_id}/unsubscribe")
async def unsubscribe_from_server(
    server_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deprecated local unsubscribe endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


# ============== USER: VIEW THEIR SUBSCRIPTIONS ==============

@router.get("/my-subscriptions")
async def get_my_subscriptions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return active/pending rentals for current user from Metrics Central."""
    remote_items = _fetch_remote_rentals()
    if not isinstance(remote_items, list):
        remote_items = []
    mine = [r for r in remote_items if r.get("renter_name") == user.username]
    inactive_statuses = {"cancelled", "canceled", "terminated", "expired", "inactive"}
    active_mine = [r for r in mine if str(r.get("status", "")).lower() not in inactive_statuses]
    return {
        "servers": [
            {
                "rental_id": r.get("rental_id"),
                "server_id": r.get("server_id"),
                "server_name": r.get("server_name"),
                "server_ip": r.get("server_ip"),
                "username": r.get("username"),
                "status": r.get("status"),
                "created_at": r.get("created_at"),
                "activated_at": r.get("activated_at"),
                "cancelled_at": r.get("cancelled_at"),
            }
            for r in active_mine
        ],
        "total": len(active_mine)
    }


# ============== USER: SERVER SUBSCRIPTION REQUESTS ==============

@router.post("/requests")
async def create_subscription_request(
    server_id: Optional[int] = None,
    duration_months: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deprecated request/approval flow endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


@router.get("/requests")
async def get_user_requests(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Deprecated request/approval flow endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


# ============== ADMIN: MANAGE SUBSCRIPTION REQUESTS ==============

@router.get("/admin/requests/pending", dependencies=[Depends(verify_admin)])
async def get_pending_requests(
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Deprecated request/approval flow endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


@router.put("/admin/requests/{request_id}/approve")
async def approve_request(
    request_id: int,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Deprecated request/approval flow endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


@router.put("/admin/requests/{request_id}/reject")
async def reject_request(
    request_id: int,
    reason: Optional[str] = None,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """Deprecated request/approval flow endpoint kept only for backward compatibility."""
    _raise_legacy_subscription_deprecated()


# ============== SYSTEM INFO ==============

@router.get("/admin/system-info", dependencies=[Depends(verify_admin)])
async def get_system_info(admin: User = Depends(verify_admin)):
    """[ADMIN] Get system hardware information (CPU cores, RAM, OS)"""
    system_info = SystemMetricsCollector.get_system_info()
    return {
        "cpu_cores": system_info["cpu_cores"],
        "ram_gb": system_info["ram_gb"],
        "os_type": system_info["os_type"]
    }


# ============== ADMIN: SET SERVER PRICE ==============

@router.put("/admin/servers/{server_id}/price")
async def set_server_price(
    server_id: str,
    price_per_month: Optional[float] = None,
    price_per_hour: Optional[float] = None,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """[ADMIN] Set server pricing metadata on Metrics Central."""
    remote_server = _get_remote_server_by_id(server_id)
    if not remote_server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Server not found"
        )
    
    effective_price_per_month = price_per_month if price_per_month is not None else price_per_hour
    if effective_price_per_month is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="price_per_month is required"
        )

    if effective_price_per_month < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Price cannot be negative"
        )
    
    _remote_json_request(
        "PUT",
        f"/api/servers/{server_id}/metadata",
        payload={
            "display_name": remote_server.get("display_name") or remote_server.get("name"),
            "specifications": remote_server.get("specifications"),
            "price_per_month": effective_price_per_month,
            "description": remote_server.get("description"),
            "is_available": bool(remote_server.get("is_available", True)),
        },
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )

    return {
        "server_id": str(server_id),
        "price_per_month": effective_price_per_month,
        "message": "Price metadata updated successfully"
    }


@router.patch("/admin/servers/{server_id}")
async def update_server(
    server_id: str,
    server_data: ServerUpdateRequest,
    admin: User = Depends(verify_admin),
    db: Session = Depends(get_db)
):
    """[ADMIN] Update server metadata on Metrics Central."""
    remote_server = _get_remote_server_by_id(server_id)
    if not remote_server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Server not found"
        )

    effective_price_per_month = (
        server_data.price_per_month
        if server_data.price_per_month is not None
        else server_data.price_per_hour
    )

    if effective_price_per_month is not None and effective_price_per_month < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Price cannot be negative"
        )

    updated_display_name = server_data.name if server_data.name is not None else (remote_server.get("display_name") or remote_server.get("name"))
    updated_specs = server_data.specs if server_data.specs is not None else remote_server.get("specifications")
    updated_price = effective_price_per_month if effective_price_per_month is not None else remote_server.get("price_per_month")
    updated_desc = remote_server.get("description")
    updated_available = bool(remote_server.get("is_available", True))

    _remote_json_request(
        "PUT",
        f"/api/servers/{server_id}/metadata",
        payload={
            "display_name": updated_display_name,
            "specifications": updated_specs,
            "price_per_month": updated_price,
            "description": updated_desc,
            "is_available": updated_available,
        },
        headers={"x-admin-key": METRICS_CENTRAL_ADMIN_TOKEN},
    )

    return {
        "server_id": str(server_id),
        "name": updated_display_name,
        "specifications": updated_specs,
        "price_per_month": updated_price,
        "message": "Server metadata updated successfully"
    }
