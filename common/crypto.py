"""
common.crypto — symmetric encryption for secrets stored at rest.

Used for per-tenant credentials that (unlike app.config/.env secrets) vary per
row and must live in the database — e.g. a tenant's Shopify OAuth access
token in shopify_connections. Uses Fernet (AES-128-CBC + HMAC); the
`cryptography` package is already a pinned dependency for JWT RS256 support.
"""
import base64
import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    raw = os.environ.get("PIQ_SECRET_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError(
            "PIQ_SECRET_ENCRYPTION_KEY is not set — required to encrypt/decrypt "
            "secrets stored at rest (e.g. shopify_connections.access_token). "
            "Set it in the git-ignored .env (see .env.example)."
        )
    # Derive a valid 32-byte urlsafe-base64 Fernet key from any passphrase via
    # SHA-256, so ops can set a plain secret string instead of having to run
    # Fernet.generate_key() themselves.
    derived = hashlib.sha256(raw.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a value for storage. Returns an opaque ascii token; blank in, blank out."""
    if not plaintext:
        return plaintext
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    """Decrypt a value produced by encrypt_secret. Blank in, blank out.

    Raises ValueError if the token is invalid or was encrypted under a
    different key (e.g. PIQ_SECRET_ENCRYPTION_KEY was rotated without
    re-encrypting existing rows) — callers should treat that as "connection
    broken, tenant must reconnect" rather than crash.
    """
    if not token:
        return token
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError("Could not decrypt secret — wrong or rotated PIQ_SECRET_ENCRYPTION_KEY") from e
