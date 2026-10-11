from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from sqlmodel import select

from app.database import SessionDep
from app.models.user import User

router = APIRouter(prefix="/marketing", tags=["marketing"])

PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Unsubscribe</title>
<style>body{{font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;text-align:center}}</style>
</head><body><h1>{title}</h1><p>{text}</p></body></html>"""


@router.get("/unsubscribe/{token}", response_class=HTMLResponse)
def unsubscribe(token: str, session: SessionDep):
    """One-click unsubscribe link included in every marketing email. No login needed."""
    user = session.exec(select(User).where(User.unsubscribe_token == token)).first()
    if user is None:
        return HTMLResponse(PAGE.format(title="Link not valid", text="This unsubscribe link is not valid."), status_code=404)
    user.marketing_opt_in = False
    user.marketing_consented_at = None
    session.add(user)
    session.commit()
    return PAGE.format(title="You're unsubscribed", text="You will no longer receive ads and discounts by email.")
