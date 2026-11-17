"""Training days: which weekdays a user trains, and which session type (and name) goes on each day.

Weekdays are numbered like Python's date.weekday(): 0 = Monday ... 6 = Sunday.
"""

import json
from collections.abc import Iterable
from dataclasses import dataclass

from app.i18n import Table, tr, weekday_name

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _plain(text: str) -> str:
    """Without the invisible direction marks: for names and notes shown on their own."""
    return text.replace("\u2068", "").replace("\u2069", "")
MAX_TRAINING_DAYS = 6  # keep at least one rest day a week

# Only used for profiles saved before training days could be chosen (they stored a count only).
# The app shows these as "set automatically" and asks the user to pick their own days.
LEGACY_DEFAULT_DAYS = {
    1: [0],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
}


def parse_days(text: str | None) -> list[int] | None:
    if not text:
        return None
    days = sorted({int(x) for x in text.split(",") if x.strip() != ""})
    return days or None


def format_days(days: Iterable[int]) -> str:
    return ",".join(str(d) for d in sorted(set(days)))


def validate_days(days: list[int]) -> list[int]:
    clean = sorted(set(days))
    if len(clean) != len(days):
        raise ValueError("Each day can only be chosen once")
    if any(d < 0 or d > 6 for d in clean):
        raise ValueError("Days must be numbers from 0 (Monday) to 6 (Sunday)")
    if not clean:
        raise ValueError("Choose at least one training day")
    if len(clean) > MAX_TRAINING_DAYS:
        raise ValueError(f"Choose up to {MAX_TRAINING_DAYS} days, so there is at least one rest day a week")
    return clean


def day_names(days: Iterable[int], short: bool = False) -> list[str]:
    return [WEEKDAY_NAMES[d][:3] if short else WEEKDAY_NAMES[d] for d in sorted(days)]


def _gap_after(days: list[int], i: int) -> int:
    """Days from days[i] to the next training day (wrapping into next week)."""
    nxt = days[(i + 1) % len(days)]
    return (nxt - days[i]) % 7 or 7


def back_to_back_pairs(days: list[int]) -> list[tuple[int, int]]:
    """Pairs of training days with no rest day between them, including Sunday -> Monday."""
    if len(days) < 2:
        return []
    return [(days[i], days[(i + 1) % len(days)]) for i in range(len(days)) if _gap_after(days, i) == 1]


def cycle_order(days: list[int]) -> list[int]:
    """The training days in the order the plan runs through them: starting right after the longest rest."""
    if len(days) <= 1:
        return list(days)
    longest = max(range(len(days)), key=lambda i: (_gap_after(days, i), -i))
    start = (longest + 1) % len(days)
    return days[start:] + days[:start]


# ---------- what each training day trains ----------

# Session types the user can pick for a day (English names; focus_label() gives the request's language),
# and what they train (used for warnings)
FOCUSES = {
    "full_body": "Full body",
    "upper": "Upper body",
    "lower": "Lower body",
    "push": "Push",
    "pull": "Pull",
    "legs": "Legs",
}

# What the user reads about their plan, in the language of the request (app.i18n)
TEXTS: Table = {
    "en": {
        **{f"focus.{k}": v for k, v in FOCUSES.items()},
        "split.full_body": "Full body",
        "split.full_body_n": "Full body x{n}",
        "split.4": "Upper / Lower",
        "split.5": "Upper / Lower / Push / Pull / Legs",
        "split.6": "Push / Pull / Legs x2",
        "why.1_3": "Training 1-3 days a week, a full-body session each day trains every muscle group more than "
        "once a week. Full-body days alternate between two exercise variations.",
        "why.back_to_back": " Some of your days are back to back: keep one of them lighter, or pick Upper / Lower for them.",
        "why.4": "Four days: upper and lower body alternate, so back-to-back days train different muscles.",
        "why.5": "Five days: each session trains different muscles from the one before.",
        "why.6": "Six days: push, pull and legs twice, so each muscle gets two days of rest before it's trained again.",
        "warn.back_to_back": "{a} ({a_focus}) and {b} ({b_focus}) are back to back and train some of the same muscles. "
        "Fine if one of them is lighter.",
        "warn.no_legs": "No day in your week trains the legs.",
        "warn.no_push": "No day in your week has pushing exercises (chest, shoulders, triceps).",
        "warn.no_pull": "No day in your week has pulling exercises (back, biceps).",
    },
    "ar": {
        "focus.full_body": "الجسم كامل",
        "focus.upper": "الجزء العلوي",
        "focus.lower": "الجزء السفلي",
        "focus.push": "دفع",
        "focus.pull": "سحب",
        "focus.legs": "الأرجل",
        "split.full_body": "الجسم كامل",
        "split.full_body_n": "الجسم كامل ×{n}",
        "split.4": "علوي / سفلي",
        "split.5": "علوي / سفلي / دفع / سحب / أرجل",
        "split.6": "دفع / سحب / أرجل ×2",
        "why.1_3": "عند التمرين 1-3 أيام في الأسبوع، تمرّن حصة الجسم الكامل كل مجموعة عضلية أكثر من مرة في الأسبوع. "
        "وتتناوب أيام الجسم الكامل بين نسختين من التمارين.",
        "why.back_to_back": " بعض أيامك متتالية: اجعل أحدها أخف، أو اختر علوي / سفلي لها.",
        "why.4": "أربعة أيام: يتناوب الجزء العلوي والسفلي، فتمرّن الأيام المتتالية عضلات مختلفة.",
        "why.5": "خمسة أيام: كل حصة تمرّن عضلات مختلفة عن الحصة السابقة.",
        "why.6": "ستة أيام: دفع وسحب وأرجل مرتين، فتحصل كل عضلة على يومي راحة قبل تمرينها مجدداً.",
        "warn.back_to_back": "{a} ({a_focus}) و{b} ({b_focus}) متتاليان ويمرّنان بعض العضلات نفسها. "
        "لا بأس إن كان أحدهما أخف.",
        "warn.no_legs": "لا يوجد يوم في أسبوعك يمرّن الأرجل.",
        "warn.no_push": "لا يوجد يوم في أسبوعك فيه تمارين دفع (الصدر، الأكتاف، الترايسبس).",
        "warn.no_pull": "لا يوجد يوم في أسبوعك فيه تمارين سحب (الظهر، الباي).",
    },
}


def focus_label(focus: str) -> str:
    """The session type's name in the request's language ("Full body" / "الجسم كامل")."""
    key = f"focus.{focus}"
    return tr(TEXTS, key) if key in TEXTS["en"] else focus
_UPPER = {"chest", "back", "shoulders", "biceps", "triceps"}
_LOWER = {"quads", "hamstrings", "glutes", "calves"}
FOCUS_MUSCLES = {
    "full_body": _UPPER | _LOWER,
    "upper": _UPPER,
    "lower": _LOWER,
    "push": {"chest", "shoulders", "triceps"},
    "pull": {"back", "biceps"},
    "legs": _LOWER,
}
MAX_DAY_NAME = 40


@dataclass
class DayChoice:
    """What the user chose for one weekday. None means "use the recommendation" / "use the session's name"."""

    focus: str | None = None
    name: str | None = None


def recommend_focus(days: list[int]) -> tuple[dict[int, str], str, str]:
    """Recommended session type for each training day, the split's name, and why.

    1-3 days: full body every day. More days: upper/lower or push/pull/legs, so muscles get rest.
    """
    n = len(days)
    order = cycle_order(days)
    if n <= 3:
        focuses = ["full_body"] * n
        name = tr(TEXTS, "split.full_body") if n == 1 else _plain(tr(TEXTS, "split.full_body_n", n=n))
        why = tr(TEXTS, "why.1_3")
        if back_to_back_pairs(days):
            why += tr(TEXTS, "why.back_to_back")
    elif n == 4:
        focuses, name = ["upper", "lower", "upper", "lower"], tr(TEXTS, "split.4")
        why = tr(TEXTS, "why.4")
    elif n == 5:
        focuses, name = ["upper", "lower", "push", "pull", "legs"], tr(TEXTS, "split.5")
        why = tr(TEXTS, "why.5")
    else:
        focuses, name = ["push", "pull", "legs", "push", "pull", "legs"], tr(TEXTS, "split.6")
        why = tr(TEXTS, "why.6")
    return dict(zip(order, focuses)), name, why


def validate_day_choices(choices: dict[int, DayChoice], days: list[int]) -> dict[int, DayChoice]:
    """Clean the user's choices: known session types, trimmed names, only for training days."""
    clean = {}
    for weekday, c in choices.items():
        if weekday not in days:
            raise ValueError(f"{WEEKDAY_NAMES[weekday]} isn't one of your training days")
        if c.focus is not None and c.focus not in FOCUSES:
            raise ValueError(f"Unknown session type '{c.focus}'. Choose from: {', '.join(FOCUSES)}")
        name = " ".join((c.name or "").split()) or None
        if name and len(name) > MAX_DAY_NAME:
            raise ValueError(f"Day names can be up to {MAX_DAY_NAME} characters")
        if c.focus or name:
            clean[weekday] = DayChoice(c.focus, name)
    return clean


def parse_day_choices(text: str | None) -> dict[int, DayChoice]:
    if not text:
        return {}
    try:
        raw = json.loads(text)
    except ValueError:
        return {}
    return {int(k): DayChoice(v.get("focus"), v.get("name")) for k, v in raw.items()}


def format_day_choices(choices: dict[int, DayChoice]) -> str | None:
    if not choices:
        return None
    return json.dumps({str(k): {"focus": c.focus, "name": c.name} for k, c in sorted(choices.items())})


def plan_warnings(focus_by_day: dict[int, str]) -> list[str]:
    """Friendly notes about a plan. They never block saving it."""
    days = sorted(focus_by_day)
    notes = []
    for a, b in back_to_back_pairs(days):
        shared = FOCUS_MUSCLES[focus_by_day[a]] & FOCUS_MUSCLES[focus_by_day[b]]
        if shared:
            notes.append(_plain(tr(TEXTS, "warn.back_to_back", a=weekday_name(a), a_focus=focus_label(focus_by_day[a]),
                                   b=weekday_name(b), b_focus=focus_label(focus_by_day[b]))))
    trained = set().union(*(FOCUS_MUSCLES[f] for f in focus_by_day.values())) if focus_by_day else set()
    if days and not trained & _LOWER:
        notes.append(tr(TEXTS, "warn.no_legs"))
    if days and not trained & {"chest", "shoulders", "triceps"}:
        notes.append(tr(TEXTS, "warn.no_push"))
    if days and not trained & {"back", "biceps"}:
        notes.append(tr(TEXTS, "warn.no_pull"))
    return notes


def effective_training_days(profile) -> list[int]:
    """The profile's chosen days, or for an older profile the defaults for its day count."""
    return parse_days(profile.training_days) or LEGACY_DEFAULT_DAYS[profile.days_per_week]


def is_training_day(profile, weekday: int) -> bool:
    return weekday in effective_training_days(profile)
