"""Training days: which weekdays a user trains, and which session type goes on each day.

Weekdays are numbered like Python's date.weekday(): 0 = Monday ... 6 = Sunday.
"""

from collections.abc import Iterable

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
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


def choose_split(days: list[int]) -> tuple[dict[int, str], str, str]:
    """Session type for each training day, the split's name, and why it was chosen.

    Back-to-back training days get different muscle groups, so nothing is trained hard two days in a row.
    """
    n = len(days)
    order = cycle_order(days)
    consecutive = bool(back_to_back_pairs(days))
    if n == 1:
        titles, name = ["Full body A"], "Full body"
        why = "One day a week: a full-body session covers every major muscle group."
    elif n == 2 and not consecutive:
        titles, name = ["Full body A", "Full body B"], "Full body A / B"
        why = "Two days with rest in between: two different full-body sessions."
    elif n == 2:
        titles, name = ["Upper", "Lower"], "Upper / Lower"
        why = "Your two days are back to back, so one trains the upper body and the other the legs."
    elif n == 3 and not consecutive:
        titles, name = ["Full body A", "Full body B", "Full body A"], "Full body A / B / A"
        why = "Three days with rest between them: full-body sessions, alternating A and B."
    elif n == 3:
        titles, name = ["Push", "Pull", "Legs"], "Push / Pull / Legs"
        why = "Some of your days are back to back, so each day trains different muscles (push, pull, legs)."
    elif n == 4:
        titles, name = ["Upper", "Lower", "Upper", "Lower"], "Upper / Lower"
        why = "Four days: upper and lower body alternate, so back-to-back days train different muscles."
    elif n == 5:
        titles, name = ["Upper", "Lower", "Push", "Pull", "Legs"], "Upper / Lower / Push / Pull / Legs"
        why = "Five days: each session trains different muscles from the one before."
    else:
        titles, name = ["Push", "Pull", "Legs", "Push", "Pull", "Legs"], "Push / Pull / Legs x2"
        why = "Six days: push, pull and legs twice, so each muscle gets two days of rest before it's trained again."
    return dict(zip(order, titles)), name, why


def effective_training_days(profile) -> list[int]:
    """The profile's chosen days, or for an older profile the defaults for its day count."""
    return parse_days(profile.training_days) or LEGACY_DEFAULT_DAYS[profile.days_per_week]


def is_training_day(profile, weekday: int) -> bool:
    return weekday in effective_training_days(profile)
