from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import List
from api.schemas.transcription import TranscriptionCreate, TranscriptionResponse
from api.models.transcription import Transcription
from api.models.recording import Recording
from db.engine import get_db

router = APIRouter(prefix="/api/transcriptions", tags=["transcriptions"])


@router.post("/", response_model=TranscriptionResponse)
def create_transcription(
    transcription: TranscriptionCreate,
    db: Session = Depends(get_db),
):
    """Create a new transcription for a recording."""
    # Verify recording exists
    recording = db.query(Recording).filter(
        Recording.id == transcription.recording_id
    ).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    db_transcription = Transcription(**transcription.dict())
    db.add(db_transcription)
    db.commit()
    db.refresh(db_transcription)
    return db_transcription


@router.get("/{recording_id}", response_model=TranscriptionResponse)
def get_transcription_by_recording(
    recording_id: str,
    db: Session = Depends(get_db),
):
    """Get transcription for a recording."""
    transcription = db.query(Transcription).filter(
        Transcription.recording_id == recording_id
    ).first()
    if not transcription:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return transcription


@router.get("/", response_model=List[TranscriptionResponse])
def list_transcriptions(db: Session = Depends(get_db)):
    """List all transcriptions."""
    transcriptions = db.query(Transcription).all()
    return transcriptions
