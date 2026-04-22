from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from api.models.plaud import PlaudConnection, PlaudDevice
from db.engine import get_db

router = APIRouter(prefix="/api/plaud", tags=["plaud"])


class PlaudConnectionResponse(BaseModel):
    """Plaud connection response model."""
    id: str
    api_base: str
    last_sync: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PlaudConnectionCreate(BaseModel):
    """Create Plaud connection."""
    bearer_token: str
    api_base: str = "https://api.plaud.ai"


@router.post("/connect", response_model=PlaudConnectionResponse)
def create_plaud_connection(
    connection: PlaudConnectionCreate,
    db: Session = Depends(get_db),
):
    """Create or update Plaud connection."""
    existing = db.query(PlaudConnection).first()

    if existing:
        # Update existing connection
        existing.bearer_token = connection.bearer_token
        existing.api_base = connection.api_base
        existing.updated_at = datetime.utcnow()
        db.add(existing)
    else:
        # Create new connection
        db_connection = PlaudConnection(**connection.dict())
        db.add(db_connection)

    db.commit()
    result = db.query(PlaudConnection).first()
    db.refresh(result)
    return result


@router.get("/connection", response_model=PlaudConnectionResponse)
def get_plaud_connection(db: Session = Depends(get_db)):
    """Get Plaud connection details."""
    connection = db.query(PlaudConnection).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Plaud connection not found")
    return connection


@router.delete("/disconnect")
def disconnect_plaud(db: Session = Depends(get_db)):
    """Disconnect Plaud connection."""
    connection = db.query(PlaudConnection).first()
    if not connection:
        raise HTTPException(status_code=404, detail="Plaud connection not found")

    db.delete(connection)
    db.commit()
    return {"message": "Plaud connection removed"}


class PlaudDeviceResponse(BaseModel):
    """Plaud device response model."""
    id: str
    serial_number: str
    name: str
    model: str
    version_number: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PlaudDeviceCreate(BaseModel):
    """Create Plaud device."""
    serial_number: str
    name: str
    model: str
    version_number: Optional[str] = None


@router.post("/devices", response_model=PlaudDeviceResponse)
def create_or_update_device(
    device: PlaudDeviceCreate,
    db: Session = Depends(get_db),
):
    """Create or update a Plaud device."""
    existing = db.query(PlaudDevice).filter(
        PlaudDevice.serial_number == device.serial_number
    ).first()

    if existing:
        existing.name = device.name
        existing.model = device.model
        existing.version_number = device.version_number
        existing.updated_at = datetime.utcnow()
        db.add(existing)
    else:
        db_device = PlaudDevice(**device.dict())
        db.add(db_device)

    db.commit()
    result = db.query(PlaudDevice).filter(
        PlaudDevice.serial_number == device.serial_number
    ).first()
    db.refresh(result)
    return result


@router.get("/devices", response_model=List[PlaudDeviceResponse])
def list_devices(db: Session = Depends(get_db)):
    """List all Plaud devices."""
    devices = db.query(PlaudDevice).order_by(PlaudDevice.name).all()
    return devices


@router.get("/devices/{serial_number}", response_model=PlaudDeviceResponse)
def get_device(serial_number: str, db: Session = Depends(get_db)):
    """Get a specific Plaud device."""
    device = db.query(PlaudDevice).filter(
        PlaudDevice.serial_number == serial_number
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.delete("/devices/{serial_number}")
def delete_device(serial_number: str, db: Session = Depends(get_db)):
    """Delete a Plaud device."""
    device = db.query(PlaudDevice).filter(
        PlaudDevice.serial_number == serial_number
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    db.delete(device)
    db.commit()
    return {"message": "Device deleted"}


@router.post("/sync")
def sync_recordings(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Sync recordings from Plaud devices."""
    connection = db.query(PlaudConnection).first()
    if not connection:
        raise HTTPException(status_code=400, detail="Plaud connection not configured")

    # TODO: Implement actual sync logic
    # For now, just update last_sync timestamp
    connection.last_sync = datetime.utcnow()
    db.add(connection)
    db.commit()

    return {
        "message": "Sync started",
        "status": "pending"
    }
