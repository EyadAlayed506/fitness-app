"""Food search: local database first, then USDA FoodData Central and Open Food Facts."""

import re

import httpx
from rapidfuzz import fuzz, process

from app.config import get_settings
from app.models.food import Food, FoodCandidate, FoodSource

USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
USDA_DATA_TYPES = ("Foundation", "SR Legacy", "Survey (FNDDS)")
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"

# USDA nutrient numbers -> our field names (USDA values are per 100 g)
USDA_NUTRIENTS = {
    "203": "protein_g",
    "205": "carbs_g",
    "204": "fat_g",
    "291": "fiber_g",
    "269": "sugar_g",
    "539": "added_sugar_g",
    "606": "saturated_fat_g",
    "605": "trans_fat_g",
    "601": "cholesterol_mg",
    "307": "sodium_mg",
    "306": "potassium_mg",
}
USDA_ENERGY_NUMBERS = ("208", "957", "958")  # kcal; 957/958 are Atwater energy in Foundation foods

# Open Food Facts nutriment keys (per 100 g or 100 ml); grams unless converted
OFF_NUTRIENTS = {
    "proteins_100g": ("protein_g", 1),
    "carbohydrates_100g": ("carbs_g", 1),
    "fat_100g": ("fat_g", 1),
    "fiber_100g": ("fiber_g", 1),
    "sugars_100g": ("sugar_g", 1),
    "added-sugars_100g": ("added_sugar_g", 1),
    "saturated-fat_100g": ("saturated_fat_g", 1),
    "trans-fat_100g": ("trans_fat_g", 1),
    "cholesterol_100g": ("cholesterol_mg", 1000),
    "sodium_100g": ("sodium_mg", 1000),
    "potassium_100g": ("potassium_mg", 1000),
}

LIQUID_QUANTITY = re.compile(r"\d\s*(ml|cl|dl|l|fl\.?\s*oz)\b", re.IGNORECASE)


ARABIC_LETTERS = re.compile(r"[\u0600-\u06ff]")
# Stricter than English (70): short Arabic words share letters easily ("برقر" vs "برتقال").
ARABIC_CUTOFF = 80
_ARABIC_FORMS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})


def squash_arabic(text: str) -> str:
    """One form for alef / taa marbuta / alef maqsura and no diacritics or tatweel, so spelling variants
    ("موزة", "موزه", "تمرة") match. Same rule as the exercise search."""
    text = text.lower().translate(_ARABIC_FORMS)
    return "".join(ch for ch in text if (ch.isalnum() or ch == " ") and not "\u064b" <= ch <= "\u0652")


def search_local(foods: list[Food], query: str, limit: int = 15, arabic: bool = False) -> list[Food]:
    """Fuzzy match on name + brand, so typos and word order still match.

    arabic=True also matches the Arabic names and search words of built-in foods ("موز" finds Banana).
    It is off by default: the coach's food lookup deliberately stays English-only (COACH-02).
    """
    if not query.strip():
        return foods[:limit]
    choices = {f.id: f"{f.name} {f.brand}".strip() for f in foods}
    matches = process.extract(
        query, choices, scorer=fuzz.WRatio, processor=lambda s: s.lower(), limit=None, score_cutoff=70
    )
    best = {key: score for _, score, key in matches}
    if arabic and ARABIC_LETTERS.search(query):
        q = squash_arabic(query)
        for f in foods:
            names = [f.name_ar or "", *(f.aliases_ar or "").split(",")]
            names = [squash_arabic(n) for n in names if n.strip()]
            if not names or not q:
                continue
            score = max(max(fuzz.WRatio(q, n), fuzz.ratio(q.replace(" ", ""), n.replace(" ", ""))) for n in names)
            if score >= ARABIC_CUTOFF and score > best.get(f.id, 0):
                best[f.id] = score
    order = {f.id: i for i, f in enumerate(foods)}
    by_id = {f.id: f for f in foods}
    ranked = sorted(best, key=lambda key: (-best[key], order[key]))
    return [by_id[key] for key in ranked[:limit]]


def parse_usda_food(item: dict) -> FoodCandidate | None:
    values: dict[str, float] = {}
    calories = None
    for n in item.get("foodNutrients", []):
        number = str(n.get("nutrientNumber", ""))
        value = n.get("value")
        if value is None:
            continue
        if number in USDA_ENERGY_NUMBERS and str(n.get("unitName", "")).upper() == "KCAL":
            calories = calories if (calories is not None and number != "208") else float(value)
        elif number in USDA_NUTRIENTS:
            values[USDA_NUTRIENTS[number]] = float(value)
    if calories is None:
        return None
    return FoodCandidate(
        name=str(item.get("description", "")).capitalize(),
        brand=item.get("brandOwner") or "",
        source=FoodSource.usda,
        external_id=str(item["fdcId"]),
        is_liquid=False,  # USDA reports per 100 g
        calories=calories,
        protein_g=values.pop("protein_g", 0.0),
        carbs_g=values.pop("carbs_g", 0.0),
        fat_g=values.pop("fat_g", 0.0),
        **values,
    )


def parse_off_product(item: dict) -> FoodCandidate | None:
    n = item.get("nutriments") or {}
    calories = n.get("energy-kcal_100g")
    if calories is None and n.get("energy_100g") is not None:
        calories = float(n["energy_100g"]) / 4.184  # kJ -> kcal
    name = (item.get("product_name") or "").strip()
    if calories is None or not name:
        return None
    values = {}
    for key, (field, factor) in OFF_NUTRIENTS.items():
        if n.get(key) is not None:
            try:
                values[field] = float(n[key]) * factor
            except (TypeError, ValueError):
                pass
    is_liquid = bool(LIQUID_QUANTITY.search(item.get("quantity") or "")) or item.get("nutrition_data_per") == "100ml"
    serving = item.get("serving_quantity")
    try:
        serving = float(serving) if serving else None
    except (TypeError, ValueError):
        serving = None
    return FoodCandidate(
        name=name,
        brand=(item.get("brands") or "").split(",")[0].strip(),
        source=FoodSource.off,
        external_id=str(item.get("code", "")),
        is_liquid=is_liquid,
        serving_size=serving if serving and serving > 0 else None,
        serving_unit=("ml" if is_liquid else "g") if serving and serving > 0 else None,
        calories=round(float(calories), 1),
        protein_g=values.pop("protein_g", 0.0),
        carbs_g=values.pop("carbs_g", 0.0),
        fat_g=values.pop("fat_g", 0.0),
        **values,
    )


async def search_usda(client: httpx.AsyncClient, query: str, limit: int = 8) -> list[FoodCandidate]:
    settings = get_settings()
    # USDA's JSON form (POST). Measured 2026-11-24 with a real key: the GET form of this search answered
    # 400 Bad Request to 12 of 30 identical requests (however the spaces were encoded); POST answered 15 of 15.
    resp = await client.post(
        USDA_SEARCH_URL,
        params={"api_key": settings.usda_api_key},
        json={"query": query, "pageSize": limit, "dataType": list(USDA_DATA_TYPES)},
        timeout=settings.external_timeout_seconds,
    )
    resp.raise_for_status()
    results = [parse_usda_food(item) for item in resp.json().get("foods", [])]
    return [r for r in results if r is not None]


async def search_off(client: httpx.AsyncClient, query: str, limit: int = 8) -> list[FoodCandidate]:
    settings = get_settings()
    resp = await client.get(
        OFF_SEARCH_URL,
        params={
            "search_terms": query,
            "search_simple": 1,
            "action": "process",
            "json": 1,
            "page_size": limit,
            "fields": "code,product_name,brands,nutriments,quantity,serving_quantity,nutrition_data_per",
        },
        headers={"User-Agent": settings.off_user_agent},
        timeout=settings.external_timeout_seconds,
    )
    resp.raise_for_status()
    results = [parse_off_product(item) for item in resp.json().get("products", [])]
    return [r for r in results if r is not None]


# ---- Protecting the online databases (and their rate limits) -----------------------------------------
# All testers share the server's address, so the limits are shared too: USDA's DEMO_KEY allows 30 requests
# an hour, Open Food Facts 10 searches a minute. The app searches as you type, so without this one word
# could cost a dozen requests.

MIN_ONLINE_QUERY = 3  # "l", "lk", "مو": local results only
ONLINE_CACHE_SECONDS = 6 * 3600  # the same words again (from anyone) reuse the earlier answer
BACKOFF_SECONDS = 60  # after a 429/503, give that source a minute before asking again
BACKOFF_STATUSES = (429, 503)
_MAX_CACHED = 500

_cache: dict[tuple[str, str], tuple[float, list[FoodCandidate]]] = {}
_backoff: dict[str, tuple[float, str]] = {}  # source label -> (until, warning key)


def reset_online_state() -> None:
    """Forget cached answers and back-offs (tests; or after changing USDA_API_KEY without a restart)."""
    _cache.clear()
    _backoff.clear()


def cached(label: str, query: str, now: float) -> list[FoodCandidate] | None:
    hit = _cache.get((label, query.strip().lower()))
    return hit[1] if hit and hit[0] > now else None


def remember(label: str, query: str, results: list[FoodCandidate], now: float) -> None:
    if len(_cache) >= _MAX_CACHED:
        _cache.clear()  # crude, but bounded; a pilot never gets near this
    _cache[(label, query.strip().lower())] = (now + ONLINE_CACHE_SECONDS, results)


def backing_off(label: str, now: float) -> str | None:
    """The warning key to show while this source is resting after a 429/503, else None."""
    entry = _backoff.get(label)
    return entry[1] if entry and entry[0] > now else None


def start_backoff(label: str, warning: str, now: float) -> None:
    _backoff[label] = (now + BACKOFF_SECONDS, warning)
