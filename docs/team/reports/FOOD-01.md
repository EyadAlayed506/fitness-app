# FOOD-01 — Arabic food search

| Field | Value |
|---|---|
| Owner | Alzoman |
| Branch | `alzoman-arabic-food-search` (from `merged_branch` @ `4a3a3f2`) |
| Date | 2026-11-24 |
| Found by | APP-02 browser test + Alzoman on his PC: "موز" found no plain banana, and "USDA unreachable" on every Arabic search |
| Status | Code and tests written; **tests not yet run** (no packages in the agent sandbox) — CI runs them on push |

## Cause

- The 38 built-in foods had English names only, so an Arabic search could never match them.
- USDA's data is English: an Arabic query is useless there, and any failure (timeout, rate limit of the shared
  `DEMO_KEY`, bad response) was shown as "unreachable" without the server recording why.
- What did appear came from Open Food Facts (packaged products with Arabic labels: banana milk, ice-cream sandwich).

## Changed behaviour

- Built-in foods have an Arabic name and search words (`name_ar`, `aliases_ar`; two optional columns, filled
  automatically on existing databases, nothing else changed). Search matches them with the exercise search's
  spelling rules (أ/إ/آ → ا, ة → ه, ى → ي, no diacritics). Arabic matching is a little stricter (80 vs 70).
- In Arabic the app shows the Arabic name (search, food detail, recent foods, the day's log). The English name
  stays the identity (database, logs, coach, online search).
- Arabic search: USDA is asked for the English name of the best built-in match ("موز" → "Banana"); with no
  built-in match USDA is skipped instead of reported "unreachable". Open Food Facts still gets the Arabic words.
- A failed online search is logged in the server console with its reason (e.g. `HTTPStatusError, HTTP 429`),
  never the URL (USDA's contains the API key).
- **Not changed:** the coach's food lookup stays English-only, because COACH-02's tests rely on it
  (`search_local(..., arabic=True)` is opt-in). Nawaf can turn it on for the coach later and update his cases.

## Part 2 — rate limits (found from the server log, 2026-11-24 21:3x)

Log evidence on Alzoman's PC: USDA answered **HTTP 429** every time (the shared `DEMO_KEY`: 30 requests/hour,
50/day per address), Open Food Facts **HTTP 503** most of the time (its search limit is 10/minute per address).
The app searches as you type, so one word ("l", "lk", "lم", "مو", "موظ", "موز") cost 6 online searches. On the
hosted server every tester shares one address, so these limits are shared by the whole pilot.

Changes (server only, no app change):
- No online search for 1–2 characters (local results only).
- Online answers are remembered for 6 hours per source and words (any user): the same food costs one request.
- After a 429/503 a source rests for 60 s instead of being asked on every keystroke.
- A 429 is shown as "{source} is busy right now. Try again in a minute" (Arabic too); "unreachable" stays for real
  connection failures. Connection failures are neither remembered nor rested.

Still needed: a personal USDA key on the server (`USDA_API_KEY`, free at https://api.data.gov/signup).
Tests: 4 more in `tests/test_food_arabic.py`; `tests/conftest.py` resets the remembered answers between tests.

## Recommended config (no code)

Get a free personal USDA key (api.data.gov) for the pilot server's `.env` (`USDA_API_KEY=`); `DEMO_KEY` is shared
and rate-limited.

## Arabic names — please review (native speaker)

| English | Arabic name | Arabic search words |
|---|---|---|
| Chicken breast, roasted, skinless | صدر دجاج مشوي بدون جلد | صدر دجاج، صدور دجاج، دجاج |
| White rice, cooked | أرز أبيض مطبوخ | رز، رز أبيض، أرز |
| Brown rice, cooked | أرز بني مطبوخ | رز بني |
| Egg, whole, large | بيضة كاملة كبيرة | بيض، بيضة، بيض مسلوق |
| Egg white | بياض البيض | بياض بيض |
| Banana | موز | موزة، موزه |
| Apple | تفاح | تفاحة |
| Orange | برتقال | برتقالة |
| Oats, rolled, dry | شوفان (جاف) | شوفان |
| Whole wheat bread | خبز قمح كامل | خبز أسمر، خبز بر، توست أسمر |
| White bread | خبز أبيض | توست، توست أبيض |
| Pita bread, white | خبز عربي أبيض | خبز عربي، خبز شامي، خبز بيتا |
| Pasta, cooked | معكرونة مطبوخة | معكرونة، مكرونة، باستا |
| Potato, baked | بطاطس مشوية | بطاطس، بطاطا |
| Sweet potato, baked | بطاطا حلوة مشوية | بطاطا حلوة، بطاطس حلوة |
| Salmon, cooked | سلمون مطبوخ | سلمون، سمك سلمون |
| Tuna, canned in water | تونة معلبة بالماء | تونة، تونا |
| Ground beef 85% lean, cooked | لحم بقري مفروم مطبوخ (85% لحم) | لحم مفروم، مفروم، لحم بقري |
| Greek yogurt, plain, nonfat | زبادي يوناني سادة خالي الدسم | زبادي يوناني، زبادي |
| Cheddar cheese | جبن شيدر | جبنة شيدر، شيدر |
| Almonds | لوز | لوزة |
| Peanut butter | زبدة الفول السوداني | زبدة فول سوداني، زبدة فستق |
| Avocado | أفوكادو | افوكادو |
| Broccoli, cooked | بروكلي مطبوخ | بروكلي |
| Lentils, cooked | عدس مطبوخ | عدس |
| Chickpeas, cooked | حمص حب مطبوخ | حمص حب، حمص مسلوق |
| Hummus | حمص | حمص بالطحينة، حمّص |
| Falafel | فلافل | طعمية |
| Dates, Medjool | تمر مجدول | تمر، تمرة، تمور |
| Cucumber | خيار | خيارة |
| Tomato | طماطم | طماطة، بندورة |
| Milk, whole | حليب كامل الدسم | حليب |
| Milk, skim | حليب منزوع الدسم | حليب خالي الدسم |
| Orange juice | عصير برتقال | عصير |
| Cola soft drink | مشروب غازي (كولا) | كولا، بيبسي، مشروب غازي |
| Coffee, black | قهوة سوداء | قهوة، أمريكانو |
| Water | ماء | موية، مويه |
| Olive oil | زيت زيتون | زيت |

## Checks

| Check | Result |
|---|---|
| `compileall app tests` | Pass |
| Spelling normaliser + search routing, run directly (fuzzy scoring stubbed as exact match) | 10/10 |
| `tests/test_food_arabic.py` (18 incl. parametrised) and the full suite | **Not run here** — CI on push |
