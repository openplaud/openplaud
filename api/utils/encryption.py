import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2
from api.config import settings


def get_encryption_key() -> bytes:
    """Get or derive encryption key from settings."""
    if settings.encryption_key:
        # If key is provided as base64 string, decode it
        if isinstance(settings.encryption_key, str):
            return base64.b64decode(settings.encryption_key)
        return settings.encryption_key

    # Fallback: derive from secret_key
    if settings.secret_key:
        kdf = PBKDF2(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"openplaud_salt",
            iterations=100000,
            backend=default_backend(),
        )
        return kdf.derive(settings.secret_key.encode())

    raise ValueError("No encryption key available")


def encrypt_value(value: str) -> str:
    """
    Encrypt a value using AES-256-GCM.
    Returns base64-encoded string of (nonce + ciphertext + tag).
    """
    if not value:
        return value

    key = get_encryption_key()
    cipher = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce
    ciphertext = cipher.encrypt(nonce, value.encode(), None)

    # Combine nonce + ciphertext and encode
    encrypted_data = nonce + ciphertext
    return base64.b64encode(encrypted_data).decode()


def decrypt_value(encrypted_value: str) -> str:
    """
    Decrypt a value encrypted with encrypt_value.
    Expects base64-encoded string of (nonce + ciphertext + tag).
    """
    if not encrypted_value:
        return encrypted_value

    key = get_encryption_key()
    cipher = AESGCM(key)

    # Decode from base64
    encrypted_data = base64.b64decode(encrypted_value.encode())

    # Extract nonce (first 12 bytes) and ciphertext (remaining)
    nonce = encrypted_data[:12]
    ciphertext = encrypted_data[12:]

    try:
        plaintext = cipher.decrypt(nonce, ciphertext, None)
        return plaintext.decode()
    except Exception as e:
        raise ValueError(f"Decryption failed: {e}")
