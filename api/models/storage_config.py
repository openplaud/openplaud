from sqlalchemy import Column, String, DateTime, JSON
from sqlalchemy.sql import func
from db.base import Base
import uuid


class StorageConfig(Base):
    __tablename__ = "storage_config"

    id = Column(String(21), primary_key=True, default=lambda: str(uuid.uuid4())[:21])
    storage_type = Column(String(10), nullable=False)  # 'local' or 's3'
    s3_config = Column(JSON, nullable=True)  # { endpoint, bucket, region, accessKeyId, secretAccessKey }
    created_at = Column(DateTime, default=func.now(), nullable=False)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)
