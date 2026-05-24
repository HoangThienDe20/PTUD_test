from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, LargeBinary, String, Text

from app.db import Base


class Server(Base):
    __tablename__ = "servers"

    server_id = Column(String(64), primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    ip = Column(String(64), nullable=True)
    cpu_cores = Column(Integer, nullable=True)
    cpu_physical_cores = Column(Integer, nullable=True)
    ram_total_gb = Column(Float, nullable=True)
    os = Column(String(80), nullable=True)
    architecture = Column(String(80), nullable=True)
    note = Column(Text, nullable=True)
    cpu = Column(Float, nullable=True)
    ram = Column(Float, nullable=True)
    disk = Column(Float, nullable=True)
    ram_used_gb = Column(Float, nullable=True)
    ram_available_gb = Column(Float, nullable=True)
    uptime = Column(String(120), nullable=True)
    registered_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_registered = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_updated = Column(DateTime, default=datetime.utcnow, nullable=False)


class ServerMetadata(Base):
    __tablename__ = "server_metadata"

    server_id = Column(String(64), primary_key=True, index=True)
    display_name = Column(String(120), nullable=True)
    specifications = Column(Text, nullable=True)
    price_per_month = Column(Float, nullable=False, default=0)
    description = Column(Text, nullable=True)
    is_available = Column(Boolean, nullable=False, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Rental(Base):
    __tablename__ = "rentals"

    rental_id = Column(String(64), primary_key=True, index=True)
    server_id = Column(String(64), nullable=False, index=True)
    server_name = Column(String(120), nullable=True)
    server_ip = Column(String(64), nullable=True)
    username = Column(String(120), nullable=True)
    private_key = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, index=True)
    renter_name = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    activated_at = Column(DateTime, nullable=True)
    cancel_requested_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)


class Task(Base):
    __tablename__ = "tasks"

    task_id = Column(String(64), primary_key=True, index=True)
    rental_id = Column(String(64), nullable=True, index=True)
    server_id = Column(String(64), nullable=False, index=True)
    action = Column(String(32), nullable=False, index=True)
    username = Column(String(120), nullable=True)
    public_key = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, index=True, default="pending")
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    picked_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
