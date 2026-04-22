import requests
from typing import List, Dict, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class PlaudAPIClient:
    """Client for Plaud API integration."""

    def __init__(self, bearer_token: str, api_base: str = "https://api.plaud.ai"):
        self.bearer_token = bearer_token
        self.api_base = api_base
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {bearer_token}",
            "Content-Type": "application/json",
        })

    def get_devices(self) -> List[Dict]:
        """Get list of Plaud devices."""
        try:
            response = self.session.get(f"{self.api_base}/v1/devices")
            response.raise_for_status()
            return response.json().get("devices", [])
        except Exception as e:
            logger.error(f"Failed to get devices: {e}")
            return []

    def get_recordings(
        self,
        device_sn: str,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict]:
        """Get recordings from a specific device."""
        try:
            params = {
                "device_sn": device_sn,
                "limit": limit,
                "offset": offset,
            }
            response = self.session.get(
                f"{self.api_base}/v1/recordings",
                params=params,
            )
            response.raise_for_status()
            return response.json().get("recordings", [])
        except Exception as e:
            logger.error(f"Failed to get recordings: {e}")
            return []

    def download_recording(
        self,
        file_id: str,
        device_sn: str,
    ) -> Optional[bytes]:
        """Download a recording file."""
        try:
            params = {
                "file_id": file_id,
                "device_sn": device_sn,
            }
            response = self.session.get(
                f"{self.api_base}/v1/recordings/download",
                params=params,
                stream=True,
            )
            response.raise_for_status()
            return response.content
        except Exception as e:
            logger.error(f"Failed to download recording: {e}")
            return None

    def update_title(
        self,
        file_id: str,
        device_sn: str,
        title: str,
    ) -> bool:
        """Update recording title on Plaud."""
        try:
            data = {
                "file_id": file_id,
                "device_sn": device_sn,
                "title": title,
            }
            response = self.session.patch(
                f"{self.api_base}/v1/recordings/title",
                json=data,
            )
            response.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"Failed to update title: {e}")
            return False

    def delete_recording(
        self,
        file_id: str,
        device_sn: str,
    ) -> bool:
        """Delete a recording on Plaud."""
        try:
            params = {
                "file_id": file_id,
                "device_sn": device_sn,
            }
            response = self.session.delete(
                f"{self.api_base}/v1/recordings",
                params=params,
            )
            response.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"Failed to delete recording: {e}")
            return False

    def test_connection(self) -> bool:
        """Test Plaud API connection."""
        try:
            response = self.session.get(f"{self.api_base}/v1/health")
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Failed to test connection: {e}")
            return False
