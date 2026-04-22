from sqlalchemy import Column, String, DateTime, Index, UniqueConstraint
from sqlalchemy.sql import func
from db.base import Base
import uuid


class PlaudConnection(Base):
    __tablename__ = "plaud_connections"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    bearer_token = Column(String, nullable=False)  # Encrypted
    api_base = Column(String, default="https://api.plaud.ai", nullable=False)
    last_sync = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)


class PlaudDevice(Base):
    __tablename__ = "plaud_devices"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    serial_number = Column(String(255), nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    model = Column(String(50), nullable=False)
    version_number = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        Index("plaud_devices_serial_number_idx", serial_number),
    )
