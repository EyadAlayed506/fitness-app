"""The language of the current request, for text the server writes (suggestions, plan names, coach replies...).

The app sends `Accept-Language: ar` or `en` with every request; `LanguageMiddleware` keeps it for that request.
Code that writes text keeps its own small table of English and Arabic texts and calls `tr(TABLE, key, ...)`.

Kept in English on purpose: error `detail` texts (the app recognises them and shows its own translation),
IDs and enum values, and names stored in the database.
"""

from contextvars import ContextVar
from typing import Literal

Language = Literal["en", "ar"]
LANGUAGES: tuple[Language, ...] = ("en", "ar")

_current: ContextVar[Language] = ContextVar("language", default="en")

# Unicode "first strong isolate" ... "pop directional isolate": keeps a number, name or unit in an Arabic
# sentence from reordering the words around it (the same as the app does).
FSI, PDI = "⁨", "⁩"


def parse_accept_language(header: str | None) -> Language:
    """Arabic when the first language asked for is Arabic ("ar", "ar-SA"), otherwise English."""
    first = (header or "").split(",")[0].split(";")[0].strip().lower()
    return "ar" if first == "ar" or first.startswith("ar-") else "en"


def current_language() -> Language:
    return _current.get()


def set_language(lang: Language):
    """Use `lang` until `reset_language(token)` (tests and background jobs; requests use the middleware)."""
    return _current.set(lang)


def reset_language(token) -> None:
    _current.reset(token)


Table = dict[str, dict[str, str]]


def tr(table: Table, key: str, **params: object) -> str:
    """The text for `key` in the current language (English if Arabic is missing), with {placeholders} filled in."""
    lang = current_language()
    template = table.get(lang, {}).get(key) or table["en"][key]
    return _fill(template, lang, params)


def _fill(template: str, lang: Language, params: dict[str, object]) -> str:
    if not params:
        return template
    if lang == "ar":
        params = {k: f"{FSI}{v}{PDI}" for k, v in params.items()}
    return template.format(**params)


def _plural_index(lang: Language, n: float) -> int:
    """Which form of a "|"-separated count text to use: English one|other; Arabic zero|one|two|few|many|other."""
    if lang == "en":
        return 0 if n == 1 else 1
    if n != int(n):
        return 5
    n = int(n)
    if n == 0:
        return 0
    if n == 1:
        return 1
    if n == 2:
        return 2
    if 3 <= n % 100 <= 10:
        return 3
    if 11 <= n % 100 <= 99:
        return 4
    return 5


def tr_count(table: Table, key: str, n: float, **params: object) -> str:
    """A count in the current language: "1 day" / "3 days", "يومان" / "3 أيام". `{n}` is filled in."""
    lang = current_language()
    text = table.get(lang, {}).get(key)
    if text is None:
        lang_used: Language = "en"
        text = table["en"][key]
    else:
        lang_used = lang
    forms = text.split("|")
    form = forms[min(_plural_index(lang_used, n), len(forms) - 1)]
    number = int(n) if n == int(n) else n
    return _fill(form, lang, {"n": number, **params})


class LanguageMiddleware:
    """Reads `Accept-Language` once per request. Plain ASGI, so the language reaches every endpoint and thread."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        header = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"accept-language"), None)
        token = _current.set(parse_accept_language(header))
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)
