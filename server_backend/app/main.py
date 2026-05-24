import secrets
from datetime import datetime, timedelta
from typing import Dict, List

from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import Base, engine, get_db
from app.models import Rental, Server, ServerMetadata, Task
from app.schemas import (
    CreateRentalRequest,
    PushMetricRequest,
    RegisterServerRequest,
    ReportTaskResultRequest,
    UpdateMetadataRequest,
)
from app.settings import ADMIN_TOKEN, METRICS_TOKEN

app = FastAPI(title="Metrics Central (PostgreSQL)")

Base.metadata.create_all(bind=engine)

# Lưu history 2 giờ gần nhất trong RAM: {server_id: [metric rows...]}
history_cache: Dict[str, List[dict]] = {}


def require_metrics_token(x_metrics_token: str = Header(default="")):
    if x_metrics_token != METRICS_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid metrics token")


def require_admin_key(x_admin_key: str = Header(default="")):
    if x_admin_key != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin key")


@app.get("/")
def root():
    return {"service": "metrics-central-postgresql", "docs": "/docs"}


@app.post("/api/servers/register", dependencies=[Depends(require_metrics_token)])
def register_server(payload: RegisterServerRequest, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.server_id == payload.server_id).first()
    now = datetime.utcnow()
    if not server:
        server = Server(
            server_id=payload.server_id,
            name=payload.name,
            ip=payload.ip,
            cpu_cores=payload.cpu_cores,
            cpu_physical_cores=payload.cpu_physical_cores,
            ram_total_gb=payload.ram_total_gb,
            os=payload.os,
            architecture=payload.architecture,
            note=payload.note,
            registered_at=now,
            last_registered=now,
            last_seen=now,
            last_updated=now,
        )
        db.add(server)
    else:
        server.name = payload.name
        server.ip = payload.ip
        server.cpu_cores = payload.cpu_cores
        server.cpu_physical_cores = payload.cpu_physical_cores
        server.ram_total_gb = payload.ram_total_gb
        server.os = payload.os
        server.architecture = payload.architecture
        server.note = payload.note
        server.last_registered = now
        server.last_seen = now
        server.last_updated = now
    db.commit()
    return {"ok": True, "server_id": payload.server_id}


@app.post("/api/metrics", dependencies=[Depends(require_metrics_token)])
def push_metrics(payload: PushMetricRequest, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.server_id == payload.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not registered")

    now = datetime.utcnow()
    server.cpu = payload.cpu
    server.ram = payload.ram
    server.disk = payload.disk
    server.ram_used_gb = payload.ram_used_gb
    server.ram_available_gb = payload.ram_available_gb
    server.uptime = payload.uptime
    server.last_seen = now
    server.last_updated = now
    db.commit()

    row = {
        "server_id": payload.server_id,
        "cpu": payload.cpu,
        "ram": payload.ram,
        "disk": payload.disk,
        "timestamp": now.isoformat(),
    }
    rows = history_cache.setdefault(payload.server_id, [])
    rows.append(row)
    threshold = datetime.utcnow() - timedelta(hours=2)
    history_cache[payload.server_id] = [
        item for item in rows if datetime.fromisoformat(item["timestamp"]) >= threshold
    ]

    return {"ok": True}


@app.get("/api/metrics/history")
def get_metrics_history(server_id: str):
    return history_cache.get(server_id, [])


@app.get("/api/servers")
def get_servers(db: Session = Depends(get_db)):
    servers = db.query(Server).all()
    metadata_map = {m.server_id: m for m in db.query(ServerMetadata).all()}
    result = []
    for s in servers:
        md = metadata_map.get(s.server_id)
        result.append(
            {
                "server_id": s.server_id,
                "name": s.name,
                "ip": s.ip,
                "cpu_cores": s.cpu_cores,
                "cpu_physical_cores": s.cpu_physical_cores,
                "ram_total_gb": s.ram_total_gb,
                "os": s.os,
                "architecture": s.architecture,
                "note": s.note,
                "cpu": s.cpu,
                "ram": s.ram,
                "disk": s.disk,
                "ram_used_gb": s.ram_used_gb,
                "ram_available_gb": s.ram_available_gb,
                "uptime": s.uptime,
                "registered_at": s.registered_at.isoformat() if s.registered_at else None,
                "last_updated": s.last_updated.isoformat() if s.last_updated else None,
                "display_name": md.display_name if md else s.name,
                "specifications": md.specifications if md else "",
                "price_per_month": md.price_per_month if md else 0,
                "description": md.description if md else "",
                "is_available": md.is_available if md else True,
            }
        )
    return result


@app.put("/api/servers/{server_id}/metadata", dependencies=[Depends(require_admin_key)])
def upsert_metadata(server_id: str, payload: UpdateMetadataRequest, db: Session = Depends(get_db)):
    row = db.query(ServerMetadata).filter(ServerMetadata.server_id == server_id).first()
    now = datetime.utcnow()
    if not row:
        row = ServerMetadata(server_id=server_id)
        db.add(row)
    row.display_name = payload.display_name
    row.specifications = payload.specifications
    row.price_per_month = payload.price_per_month
    row.description = payload.description
    row.is_available = payload.is_available
    row.updated_at = now
    db.commit()
    return {"ok": True, "server_id": server_id}


@app.post("/api/rentals/create", dependencies=[Depends(require_admin_key)])
def create_rental(payload: CreateRentalRequest, db: Session = Depends(get_db)):
    server = db.query(Server).filter(Server.server_id == payload.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    rental_id = f"rental_{secrets.token_hex(8)}"
    username = f"user_{secrets.token_hex(3)}"
    private_key = "-----BEGIN PRIVATE KEY-----\\nFAKE_KEY_FOR_FLOW\\n-----END PRIVATE KEY-----"
    now = datetime.utcnow()

    rental = Rental(
        rental_id=rental_id,
        server_id=server.server_id,
        server_name=server.name,
        server_ip=server.ip,
        username=username,
        private_key=private_key,
        status="creating",
        renter_name=payload.renter_name,
        created_at=now,
    )
    db.add(rental)

    task = Task(
        task_id=f"task_{secrets.token_hex(8)}",
        rental_id=rental_id,
        server_id=server.server_id,
        action="create_ssh_user",
        username=username,
        public_key="ssh-rsa PLACEHOLDER_PUBLIC_KEY",
        status="pending",
        created_at=now,
    )
    db.add(task)
    db.commit()

    return {
        "rental_id": rental_id,
        "server_id": server.server_id,
        "ip": server.ip,
        "port": 22,
        "username": username,
        "private_key_filename": f"{username}.pem",
        "private_key": private_key,
        "ssh_command": f"ssh -i \"{username}.pem\" {username}@{server.ip}",
    }


@app.post("/api/rentals/{rental_id}/cancel", dependencies=[Depends(require_admin_key)])
def cancel_rental(rental_id: str, db: Session = Depends(get_db)):
    rental = db.query(Rental).filter(Rental.rental_id == rental_id).first()
    if not rental:
        raise HTTPException(status_code=404, detail="Rental not found")
    if rental.status in {"cancelled", "failed", "cancel_failed"}:
        return {"ok": True, "rental_id": rental_id, "status": rental.status}

    rental.status = "cancelling"
    rental.cancel_requested_at = datetime.utcnow()

    task = Task(
        task_id=f"task_{secrets.token_hex(8)}",
        rental_id=rental.rental_id,
        server_id=rental.server_id,
        action="delete_ssh_user",
        username=rental.username,
        status="pending",
        created_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()
    return {"ok": True, "rental_id": rental_id, "status": "cancelling"}


@app.get("/api/rentals", dependencies=[Depends(require_admin_key)])
def get_rentals(db: Session = Depends(get_db)):
    rows = db.query(Rental).order_by(Rental.created_at.desc()).all()
    return [
        {
            "rental_id": r.rental_id,
            "server_id": r.server_id,
            "server_name": r.server_name,
            "server_ip": r.server_ip,
            "username": r.username,
            "status": r.status,
            "renter_name": r.renter_name,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "activated_at": r.activated_at.isoformat() if r.activated_at else None,
            "cancel_requested_at": r.cancel_requested_at.isoformat() if r.cancel_requested_at else None,
            "cancelled_at": r.cancelled_at.isoformat() if r.cancelled_at else None,
        }
        for r in rows
    ]


@app.get("/api/agent/tasks/{server_id}", dependencies=[Depends(require_metrics_token)])
def get_pending_task(server_id: str, db: Session = Depends(get_db)):
    task = (
        db.query(Task)
        .filter(Task.server_id == server_id, Task.status == "pending")
        .order_by(Task.created_at.asc())
        .first()
    )
    if not task:
        return {"task": None}

    task.status = "picked"
    task.picked_at = datetime.utcnow()
    db.commit()
    return {
        "task": {
            "task_id": task.task_id,
            "rental_id": task.rental_id,
            "server_id": task.server_id,
            "action": task.action,
            "username": task.username,
            "public_key": task.public_key,
        }
    }


@app.post("/api/agent/tasks/{task_id}/result", dependencies=[Depends(require_metrics_token)])
def report_task_result(task_id: str, payload: ReportTaskResultRequest, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.task_id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    now = datetime.utcnow()
    task.status = payload.status
    task.message = payload.message
    task.finished_at = now

    rental = db.query(Rental).filter(Rental.rental_id == task.rental_id).first() if task.rental_id else None
    if rental:
        if task.action == "create_ssh_user":
            if payload.status == "success":
                rental.status = "active"
                rental.activated_at = now
            else:
                rental.status = "failed"
        elif task.action == "delete_ssh_user":
            if payload.status == "success":
                rental.status = "cancelled"
                rental.cancelled_at = now
            else:
                rental.status = "cancel_failed"

    db.commit()
    return {"ok": True}
