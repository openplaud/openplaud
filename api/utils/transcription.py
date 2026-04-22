import os
import tempfile
from typing import Optional, Tuple
from openai import OpenAI, AsyncOpenAI
import librosa
import numpy as np
from api.config import settings


class TranscriptionService:
    """Handle transcription using local or API-based models."""

    @staticmethod
    def transcribe_local(
        audio_data: bytes,
        language: Optional[str] = None,
        model: str = "base",
    ) -> Tuple[str, str, str]:
        """
        Transcribe audio using local Whisper model (transformers.js).
        Returns (text, detected_language, model_used).

        In production, this would use Transformers.js via a background worker
        or use the local Python whisper library via python-whisper.
        For now, it's a stub.
        """
        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # TODO: Implement actual Whisper transcription
            # This is a placeholder - in production use:
            # - python-whisper library for CPU inference
            # - or call a worker service with Transformers.js
            import whisper
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_obj = whisper.load_model(model, device=device)
            result = model_obj.transcribe(tmp_path, language=language)
            return result["text"], result.get("language"), model
        except ImportError:
            # Fallback stub response
            return "(Transcription service not available)", None, "stub"
        finally:
            os.unlink(tmp_path)

    @staticmethod
    def transcribe_api(
        audio_data: bytes,
        provider: str = "openai",
        model: str = "whisper-1",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        language: Optional[str] = None,
    ) -> Tuple[str, str, str]:
        """
        Transcribe audio using API-based provider (OpenAI-compatible).
        Returns (text, detected_language, model_used).
        """
        import tempfile

        # Save audio to temporary file for upload
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            api_key = api_key or settings.openai_api_key
            if not api_key:
                raise ValueError("API key not provided")

            # Create OpenAI client with custom base URL if needed
            client_kwargs = {"api_key": api_key}
            if base_url or settings.openai_base_url:
                client_kwargs["base_url"] = base_url or settings.openai_base_url

            client = OpenAI(**client_kwargs)

            # Transcribe via API
            with open(tmp_path, "rb") as audio_file:
                transcript = client.audio.transcriptions.create(
                    model=model,
                    file=audio_file,
                    language=language,
                )

            return transcript.text, language or "unknown", model

        finally:
            os.unlink(tmp_path)

    @staticmethod
    def get_audio_duration(audio_data: bytes) -> int:
        """
        Get audio duration in milliseconds.
        """
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            y, sr = librosa.load(tmp_path, sr=None)
            duration_seconds = librosa.get_duration(y=y, sr=sr)
            return int(duration_seconds * 1000)
        finally:
            os.unlink(tmp_path)

    @staticmethod
    def estimate_quality(
        audio_data: bytes,
        threshold_db: float = -30,
    ) -> str:
        """
        Estimate audio quality based on loudness.
        Returns 'good', 'fair', or 'poor'.
        """
        import tempfile

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            y, sr = librosa.load(tmp_path, sr=None)
            S = librosa.feature.melspectrogram(y=y, sr=sr)
            S_db = librosa.power_to_db(S, ref=np.max)
            mean_loudness = np.mean(S_db)

            if mean_loudness > threshold_db:
                return "good"
            elif mean_loudness > threshold_db - 10:
                return "fair"
            else:
                return "poor"
        finally:
            os.unlink(tmp_path)
