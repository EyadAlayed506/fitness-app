import io

import segno

QR_PREFIX = "fitapp://machine/"


def qr_payload(code: str) -> str:
    return f"{QR_PREFIX}{code}"


def parse_qr_payload(text: str) -> str:
    """Accept either the full payload or just the code."""
    text = text.strip()
    return text[len(QR_PREFIX):] if text.startswith(QR_PREFIX) else text


def qr_png(code: str, scale: int = 10) -> bytes:
    buf = io.BytesIO()
    segno.make(qr_payload(code), error="m").save(buf, kind="png", scale=scale, border=2)
    return buf.getvalue()
