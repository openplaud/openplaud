from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from typing import List
from api.schemas.recording import RecordingCreate, RecordingResponse, RecordingUpdate
from api.models.recording import Recording
from db.engine import get_db

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.post("/", response_model=RecordingResponse)
def create_recording(
    recording: RecordingCreate,
    db: Session = Depends(get_db),
):
    """Create a new recording."""
    # Check if recording with same plaud_file_id already exists
    existing = db.query(Recording).filter(
        Recording.plaud_file_id == recording.plaud_file_id
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Recording already exists")

    db_recording = Recording(**recording.dict())
    db.add(db_recording)
    db.commit()
    db.refresh(db_recording)
    return db_recording


@router.get("/", response_model=List[RecordingResponse])
def list_recordings(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    sort: str = Query("newest", regex="^(newest|oldest|name)$"),
    search: str = Query("", min_length=0),
    db: Session = Depends(get_db),
):
    """List all recordings with pagination and sorting."""
    query = db.query(Recording).filter(Recording.is_trash == False)

    # Search by filename
    if search:
        query = query.filter(Recording.filename.ilike(f"%{search}%"))

    # Sort
    if sort == "newest":
        query = query.order_by(desc(Recording.start_time))
    elif sort == "oldest":
        query = query.order_by(Recording.start_time)
    else:  # name
        query = query.order_by(Recording.filename)

    total = query.count()
    recordings = query.offset(skip).limit(limit).all()
    return recordings


@router.get("/{recording_id}", response_model=RecordingResponse)
def get_recording(
    recording_id: str,
    db: Session = Depends(get_db),
):
    """Get a specific recording."""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    return recording


@router.patch("/{recording_id}", response_model=RecordingResponse)
def update_recording(
    recording_id: str,
    recording_update: RecordingUpdate,
    db: Session = Depends(get_db),
):
    """Update a recording."""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    update_data = recording_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(recording, key, value)

    recording.updated_at = datetime.utcnow()
    db.add(recording)
    db.commit()
    db.refresh(recording)
    return recording


@router.delete("/{recording_id}")
def delete_recording(
    recording_id: str,
    db: Session = Depends(get_db),
):
    """Delete a recording (move to trash)."""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    recording.is_trash = True
    recording.updated_at = datetime.utcnow()
    db.add(recording)
    db.commit()
    return {"message": "Recording moved to trash"}


@router.get("/stats/count")
def get_recordings_count(db: Session = Depends(get_db)):
    """Get total count of recordings."""
    count = db.query(func.count(Recording.id)).filter(
        Recording.is_trash == False
    ).scalar()
    return {"total": count}
