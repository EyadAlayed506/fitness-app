from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.database import SessionDep
from app.models.user import Profile, User
from app.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], session: SessionDep) -> User:
    claims = decode_token(token)
    user = session.get(User, claims[0]) if claims is not None else None
    # A disabled account, or a token older than the user's latest log-out-everywhere, is treated exactly
    # like an expired session so the app shows its normal "log in again" message.
    if user is None or user.disabled_at is not None or claims[1] != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not logged in or session expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_profile(user: CurrentUser, session: SessionDep) -> Profile:
    profile = session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not set up yet")
    return profile


CurrentProfile = Annotated[Profile, Depends(get_current_profile)]
