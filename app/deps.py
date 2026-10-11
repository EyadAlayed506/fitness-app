from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.database import SessionDep
from app.models.user import Profile, User
from app.security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], session: SessionDep) -> User:
    user_id = decode_access_token(token)
    user = session.get(User, user_id) if user_id is not None else None
    if user is None:
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
