"""Food search: local database first, then USDA FoodData Central and Open Food Facts."""

import re

import httpx
from rapidfuzz import fuzz, process

from app.config import get_settings
from app.models.food import Food, FoodCandidate, FoodSource

USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search"
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


def search_local(foods: list[Food], query: str, limit: int = 15) -> list[Food]:
    """Fuzzy match on name + brand, so typos and word order still match."""
    if not query.strip():
        return foods[:limit]
    choices = {f.id: f"{f.name} {f.brand}".strip() for f in foods}
    matches = process.extract(
        query, choices, scorer=fuzz.WRatio, processor=lambda s: s.lower(), limit=limit, score_cutoff=70
    )
    by_id = {f.id: f for f in foods}
    return [by_id[key] for _, _, key in matches]


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
    resp = await client.get(
        USDA_SEARCH_URL,
        params={
            "api_key": settings.usda_api_key,
            "query": query,
            "pageSize": limit,
            "dataType": "Foundation,SR Legacy,Survey (FNDDS)",
        },
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
