from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class RecordingBase(BaseModel):
    device_sn: str
    plaud_file_id: str
    filename: str
    duration: int
    start_time: datetime
    end_time: datetime
    filesize: int
    file_md5: str
    storage_type: str
    storage_path: str
    plaud_version: str
    timezone: Optional[int] = None
    zonemins: Optional[int] = None
    scene: Optional[int] = None


class RecordingCreate(RecordingBase):
    pass


class RecordingUpdate(BaseModel):
    filename: Optional[str] = None
    storage_path: Optional[str] = None
    downloaded_at: Optional[datetime] = None
    is_trash: Optional[bool] = None


class RecordingResponse(RecordingBase):
    id: str
    is_trash: bool
    downloaded_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
