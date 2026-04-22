from sqlalchemy import Column, String, DateTime, Boolean
from sqlalchemy.sql import func
from db.base import Base
import uuid


class APICredential(Base):
    __tablename__ = "api_credentials"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    provider = Column(String(100), nullable=False)  # 'openai', 'groq', 'together-ai'
    api_key = Column(String, nullable=False)  # Encrypted
    base_url = Column(String, nullable=True)  # e.g., 'https://api.groq.com/openai/v1'
    default_model = Column(String(100), nullable=True)
    is_default_transcription = Column(Boolean, default=False, nullable=False)
    is_default_enhancement = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
