from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from db.base import Base
import uuid


class Transcription(Base):
    __tablename__ = "transcriptions"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    recording_id = Column(String(21), ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False)
    text = Column(String, nullable=False)
    detected_language = Column(String(10), nullable=True)  # ISO 639-1
    transcription_type = Column(String(10), default="server", nullable=False)  # 'server' or 'browser'
    provider = Column(String(100), nullable=False)  # 'openai', 'groq', 'browser'
    model = Column(String(100), nullable=False)  # 'whisper-1', 'whisper-large-v3-turbo'
    created_at = Column(DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        Index("transcriptions_recording_id_idx", recording_id),
    )
