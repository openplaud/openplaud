from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from api.models.settings import Settings as AppSettings
from api.models.api_credential import APICredential
from api.models.storage_config import StorageConfig
from db.engine import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    """Settings response model."""
    sync_interval: int
    auto_sync_enabled: bool
    auto_transcribe: bool
    transcription_quality: str
    theme: str
    browser_notifications: bool
    email_notifications: bool
    default_export_format: str
    onboarding_completed: bool

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    """Settings update model."""
    sync_interval: Optional[int] = None
    auto_sync_enabled: Optional[bool] = None
    auto_transcribe: Optional[bool] = None
    transcription_quality: Optional[str] = None
    theme: Optional[str] = None
    browser_notifications: Optional[bool] = None
    email_notifications: Optional[bool] = None
    notification_email: Optional[str] = None
    default_export_format: Optional[str] = None
    onboarding_completed: Optional[bool] = None


def get_or_create_settings(db: Session) -> AppSettings:
    """Get or create the singleton settings record."""
    settings = db.query(AppSettings).first()
    if not settings:
        settings = AppSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("/", response_model=SettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    """Get application settings."""
    settings = get_or_create_settings(db)
    return settings


@router.patch("/", response_model=SettingsResponse)
def update_settings(
    settings_update: SettingsUpdate,
    db: Session = Depends(get_db),
):
    """Update application settings."""
    settings = get_or_create_settings(db)

    update_data = settings_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(settings, key, value)

    settings.updated_at = datetime.utcnow()
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


class APICredentialResponse(BaseModel):
    """API credential response model."""
    id: str
    provider: str
    is_default_transcription: bool
    is_default_enhancement: bool

    class Config:
        from_attributes = True


@router.get("/providers", response_model=list[APICredentialResponse])
def list_api_providers(db: Session = Depends(get_db)):
    """List configured API providers."""
    providers = db.query(APICredential).all()
    return providers


@router.post("/providers", response_model=APICredentialResponse)
def add_api_provider(
    provider: str,
    api_key: str,
    base_url: Optional[str] = None,
    default_model: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Add a new API provider."""
    # Note: In production, encrypt api_key
    credential = APICredential(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        default_model=default_model,
    )
    db.add(credential)
    db.commit()
    db.refresh(credential)
    return credential


@router.delete("/providers/{provider_id}")
def delete_api_provider(
    provider_id: str,
    db: Session = Depends(get_db),
):
    """Delete an API provider."""
    credential = db.query(APICredential).filter(
        APICredential.id == provider_id
    ).first()
    if not credential:
        raise HTTPException(status_code=404, detail="Provider not found")

    db.delete(credential)
    db.commit()
    return {"message": "Provider deleted"}


class StorageConfigResponse(BaseModel):
    """Storage configuration response model."""
    storage_type: str
    s3_config: Optional[dict] = None

    class Config:
        from_attributes = True


@router.get("/storage", response_model=StorageConfigResponse)
def get_storage_config(db: Session = Depends(get_db)):
    """Get storage configuration."""
    config = db.query(StorageConfig).first()
    if not config:
        config = StorageConfig(storage_type="local")
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.patch("/storage", response_model=StorageConfigResponse)
def update_storage_config(
    storage_type: str,
    s3_config: Optional[dict] = None,
    db: Session = Depends(get_db),
):
    """Update storage configuration."""
    config = db.query(StorageConfig).first()
    if not config:
        config = StorageConfig(storage_type=storage_type, s3_config=s3_config)
    else:
        config.storage_type = storage_type
        if s3_config:
            config.s3_config = s3_config

    config.updated_at = datetime.utcnow()
    db.add(config)
    db.commit()
    db.refresh(config)
    return config
