from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.config import get_settings

password_hash = PasswordHash.recommended()  # Argon2


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: int, version: int | None = 0) -> str:
    """A login token. `version` is the user's token_version: bumping it on the user ends every older token."""
    settings = get_settings()
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "ver": version or 0, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> tuple[int, int] | None:
    """Return (user id, token version) inside the token, or None if the token is invalid or expired.

    Tokens made before versions existed have no "ver" and count as version 0.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"]), int(payload.get("ver", 0))
    except (jwt.InvalidTokenError, KeyError, ValueError, TypeError):
        return None


def decode_access_token(token: str) -> int | None:
    """Return the user id inside the token, or None if the token is invalid or expired."""
    claims = decode_token(token)
    return claims[0] if claims else None
