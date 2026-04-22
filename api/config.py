from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database
    database_url: str
    database_echo: bool = False

    # API
    api_host: str = "localhost"
    api_port: int = 8000
    api_reload: bool = False

    # Streamlit
    streamlit_password: Optional[str] = None
    streamlit_host: str = "localhost"
    streamlit_port: int = 8501

    # Security
    secret_key: str
    encryption_key: Optional[str] = None

    # Storage
    storage_type: str = "local"  # 'local' or 's3'
    storage_local_path: str = "/data/recordings"
    s3_endpoint: Optional[str] = None
    s3_bucket: Optional[str] = None
    s3_region: Optional[str] = None
    s3_access_key: Optional[str] = None
    s3_secret_key: Optional[str] = None

    # AI Providers
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None

    # Plaud
    plaud_api_base: str = "https://api.plaud.ai"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
