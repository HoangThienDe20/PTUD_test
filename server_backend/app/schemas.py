from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class RegisterServerRequest(BaseModel):
    server_id: str
    name: str
    ip: Optional[str] = None
    cpu_cores: Optional[int] = None
    cpu_physical_cores: Optional[int] = None
    ram_total_gb: Optional[float] = None
    os: Optional[str] = None
    architecture: Optional[str] = None
    note: Optional[str] = None


class PushMetricRequest(BaseModel):
    server_id: str
    cpu: Optional[float] = None
    ram: Optional[float] = None
    disk: Optional[float] = None
    ram_used_gb: Optional[float] = None
    ram_available_gb: Optional[float] = None
    uptime: Optional[str] = None
    ts: Optional[datetime] = None


class UpdateMetadataRequest(BaseModel):
    display_name: str
    specifications: str
    price_per_month: float = Field(ge=0)
    description: Optional[str] = None
    is_available: bool = True


class CreateRentalRequest(BaseModel):
    server_id: str
    renter_name: str


class ReportTaskResultRequest(BaseModel):
    status: str
    message: Optional[str] = None
