from sqlalchemy import Column, String, Integer, DateTime, Boolean, Index
from sqlalchemy.sql import func
from datetime import datetime
from db.base import Base
import uuid


class Recording(Base):
    __tablename__ = "recordings"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    device_sn = Column(String(255), nullable=False)
    plaud_file_id = Column(String(255), nullable=False, unique=True, index=True)
    filename = Column(String, nullable=False)
    duration = Column(Integer, nullable=False)  # milliseconds
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    filesize = Column(Integer, nullable=False)  # bytes
    file_md5 = Column(String(32), nullable=False)

    # Storage info
    storage_type = Column(String(10), nullable=False)  # 'local' or 's3'
    storage_path = Column(String, nullable=False)
    downloaded_at = Column(DateTime, nullable=True)

    # Metadata
    plaud_version = Column(String(50), nullable=False)
    timezone = Column(Integer, nullable=True)
    zonemins = Column(Integer, nullable=True)
    scene = Column(Integer, nullable=True)
    is_trash = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("recordings_start_time_idx", start_time),
        Index("recordings_plaud_file_id_idx", plaud_file_id),
    )
