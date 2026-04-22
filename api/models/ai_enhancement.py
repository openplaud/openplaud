from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.sql import func
from db.base import Base
import uuid


class AIEnhancement(Base):
    __tablename__ = "ai_enhancements"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    recording_id = Column(String(21), ForeignKey("recordings.id", ondelete="CASCADE"), nullable=False)
    summary = Column(String, nullable=True)
    action_items = Column(JSON, nullable=True)  # Array of action items
    key_points = Column(JSON, nullable=True)  # Array of key points
    provider = Column(String(100), nullable=False)  # 'openai', 'anthropic'
    model = Column(String(100), nullable=False)  # 'gpt-4o', 'claude-3.5-sonnet'
    created_at = Column(DateTime, default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("recording_id", name="ai_enhancements_recording_id_unique"),
    )
