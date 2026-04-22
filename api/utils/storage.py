import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional
from api.config import settings


class StorageBackend(ABC):
    """Abstract storage backend."""

    @abstractmethod
    def save_file(self, file_path: str, file_data: bytes) -> str:
        """Save file and return storage path."""
        pass

    @abstractmethod
    def load_file(self, file_path: str) -> bytes:
        """Load file from storage."""
        pass

    @abstractmethod
    def delete_file(self, file_path: str) -> bool:
        """Delete file from storage."""
        pass

    @abstractmethod
    def get_url(self, file_path: str) -> str:
        """Get URL or path to access file."""
        pass

    @abstractmethod
    def exists(self, file_path: str) -> bool:
        """Check if file exists."""
        pass


class LocalStorageBackend(StorageBackend):
    """Local filesystem storage backend."""

    def __init__(self, base_path: str = None):
        self.base_path = Path(base_path or settings.storage_local_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save_file(self, file_path: str, file_data: bytes) -> str:
        """Save file to local filesystem."""
        full_path = self.base_path / file_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, "wb") as f:
            f.write(file_data)
        return str(file_path)

    def load_file(self, file_path: str) -> bytes:
        """Load file from local filesystem."""
        full_path = self.base_path / file_path
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        with open(full_path, "rb") as f:
            return f.read()

    def delete_file(self, file_path: str) -> bool:
        """Delete file from local filesystem."""
        full_path = self.base_path / file_path
        if full_path.exists():
            full_path.unlink()
            return True
        return False

    def get_url(self, file_path: str) -> str:
        """Get file path (for local storage)."""
        return str(self.base_path / file_path)

    def exists(self, file_path: str) -> bool:
        """Check if file exists."""
        return (self.base_path / file_path).exists()


class S3StorageBackend(StorageBackend):
    """S3-compatible storage backend (AWS S3, Minio, etc.)."""

    def __init__(self):
        try:
            import boto3
        except ImportError:
            raise ImportError("boto3 is required for S3 storage")

        self.s3_client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
        )
        self.bucket = settings.s3_bucket

    def save_file(self, file_path: str, file_data: bytes) -> str:
        """Upload file to S3."""
        try:
            self.s3_client.put_object(
                Bucket=self.bucket,
                Key=file_path,
                Body=file_data,
            )
            return file_path
        except Exception as e:
            raise Exception(f"S3 upload failed: {e}")

    def load_file(self, file_path: str) -> bytes:
        """Download file from S3."""
        try:
            response = self.s3_client.get_object(
                Bucket=self.bucket,
                Key=file_path,
            )
            return response["Body"].read()
        except Exception as e:
            raise FileNotFoundError(f"S3 file not found: {file_path}: {e}")

    def delete_file(self, file_path: str) -> bool:
        """Delete file from S3."""
        try:
            self.s3_client.delete_object(
                Bucket=self.bucket,
                Key=file_path,
            )
            return True
        except Exception:
            return False

    def get_url(self, file_path: str, expiration: int = 3600) -> str:
        """Get presigned URL for file."""
        try:
            url = self.s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": file_path},
                ExpiresIn=expiration,
            )
            return url
        except Exception as e:
            raise Exception(f"Failed to generate presigned URL: {e}")

    def exists(self, file_path: str) -> bool:
        """Check if file exists in S3."""
        try:
            self.s3_client.head_object(Bucket=self.bucket, Key=file_path)
            return True
        except:
            return False


def get_storage_backend() -> StorageBackend:
    """Factory function to get appropriate storage backend."""
    if settings.storage_type == "s3":
        return S3StorageBackend()
    else:
        return LocalStorageBackend()
