from sqlalchemy import Column, String, DateTime, Boolean, Integer, Float, JSON
from sqlalchemy.sql import func
from db.base import Base
import uuid


class Settings(Base):
    __tablename__ = "app_settings"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])

    # Sync settings
    sync_interval = Column(Integer, default=300000, nullable=False)  # milliseconds
    auto_sync_enabled = Column(Boolean, default=True, nullable=False)
    sync_on_mount = Column(Boolean, default=True, nullable=False)
    sync_on_visibility_change = Column(Boolean, default=True, nullable=False)
    sync_notifications = Column(Boolean, default=True, nullable=False)
    auto_transcribe = Column(Boolean, default=False, nullable=False)

    # Playback settings
    default_playback_speed = Column(Float, default=1.0, nullable=False)
    default_volume = Column(Integer, default=75, nullable=False)
    auto_play_next = Column(Boolean, default=False, nullable=False)

    # Transcription settings
    default_transcription_language = Column(String(10), nullable=True)  # ISO 639-1
    transcription_quality = Column(String(20), default="balanced", nullable=False)  # 'fast', 'balanced', 'accurate'

    # Display/UI settings
    date_time_format = Column(String(20), default="relative", nullable=False)  # 'relative', 'absolute', 'iso'
    recording_list_sort_order = Column(String(20), default="newest", nullable=False)  # 'newest', 'oldest', 'name'
    items_per_page = Column(Integer, default=50, nullable=False)
    theme = Column(String(20), default="system", nullable=False)  # 'light', 'dark', 'system'

    # Storage settings
    auto_delete_recordings = Column(Boolean, default=False, nullable=False)
    retention_days = Column(Integer, nullable=True)

    # Notification settings
    browser_notifications = Column(Boolean, default=True, nullable=False)
    email_notifications = Column(Boolean, default=False, nullable=False)
    bark_notifications = Column(Boolean, default=False, nullable=False)
    notification_sound = Column(Boolean, default=True, nullable=False)
    notification_email = Column(String(255), nullable=True)
    bark_push_url = Column(String, nullable=True)

    # Export/Backup settings
    default_export_format = Column(String(10), default="json", nullable=False)
    auto_export = Column(Boolean, default=False, nullable=False)
    backup_frequency = Column(String(20), nullable=True)  # 'daily', 'weekly', 'monthly'

    # Provider settings
    default_providers = Column(JSON, nullable=True)  # { transcription: 'openai', enhancement: 'claude' }

    # Onboarding
    onboarding_completed = Column(Boolean, default=False, nullable=False)

    # Title generation
    auto_generate_title = Column(Boolean, default=True, nullable=False)
    sync_title_to_plaud = Column(Boolean, default=False, nullable=False)
    title_generation_prompt = Column(JSON, nullable=True)
    summary_prompt = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
