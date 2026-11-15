"""Keep one-time codes and private links out of the server's request log.

uvicorn's access log prints each request's full URL. Two kinds of URL carry something private:
- /api/whoop/callback?code=...&state=...  (WHOOP's one-time login code)
- /api/marketing/unsubscribe/<token>      (a personal unsubscribe link)
Login tokens are sent in a header, so they never reach this log.
"""

import logging
import re

REDACTED = "[redacted]"
_RULES = [
    (re.compile(r"(/api/marketing/unsubscribe/)[^/?#\s\"]+"), rf"\g<1>{REDACTED}"),
    (re.compile(r"([?&](?:code|state|token|access_token|refresh_token)=)[^&#\s\"]*"), rf"\g<1>{REDACTED}"),
]


def redact(text: str) -> str:
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    return text


class RedactUrls(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
        return True  # never drops a line, only edits it


def install() -> None:
    """Add the filter to uvicorn's access log (once)."""
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactUrls) for f in logger.filters):
        logger.addFilter(RedactUrls())
