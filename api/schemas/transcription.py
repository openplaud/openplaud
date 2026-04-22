from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class TranscriptionBase(BaseModel):
    recording_id: str
    text: str
    detected_language: Optional[str] = None
    transcription_type: str = "server"
    provider: str
    model: str


class TranscriptionCreate(TranscriptionBase):
    pass


class TranscriptionResponse(TranscriptionBase):
    id: str
    created_at: datetime

    class Config:
        from_attributes = True
