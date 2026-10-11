"""Wellness points: small rewards for healthy habits, from one table of rules.

Principles:
- Points only for things that are recorded: a finished workout with sets, a night of sleep, food logs,
  a weigh-in. Nothing is guessed.
- Points are never taken away, and there are no penalties for missing a day.
- Workouts earn points up to the number of training days in the plan each week, one per day, so extra
  sessions and skipped rest days earn nothing more.
- Each award has a unique key per user, so checking the rules again never gives the same points twice.
- Only days since the user signed up count, and only recent days are checked (LOOKBACK_DAYS).
"""

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.models.food import FoodLog
from app.models.points import Achievement, PointAward
from app.models.user import Profile, User, WeightEntry
from app.services.activity import (
    completed_workouts,
    local_date,
    sleep_goal,
    sleep_nights,
    week_start,
)
from app.services.plan import build_plan
from app.services.schedule import effective_training_days


@dataclass(frozen=True)
class PointsRule:
    id: str
    points: int
    label: str
    description: str


RULES = {
    r.id: r
    for r in [
        PointsRule(
            "workout", 20, "Planned workout",
            "A finished workout with at least one set. Counts once a day, up to the number of training days "
            "in your plan each week, so extra sessions don't earn more and rest days never cost you anything.",
        ),
        PointsRule("full_week", 30, "Full week", "Every planned session done in a week (Monday to Sunday)."),
        PointsRule(
            "sleep_goal", 10, "Sleep goal",
            "A night of at least your sleep goal, from WHOOP or logged by hand within 2 days of waking up.",
        ),
        PointsRule(
            "nutrition", 10, "Eating to plan",
            "A finished day with at least 2 foods logged (by the next day) and calories within 10% of your target.",
        ),
        PointsRule("weigh_in", 5, "Weekly weigh-in", "At least one weigh-in in a week."),
    ]
}

LOOKBACK_DAYS = 14
MANUAL_SLEEP_GRACE_DAYS = 2
NUTRITION_TOLERANCE = 0.10
NUTRITION_MIN_LOGS = 2
LEVEL_STEP = 50  # level n starts at LEVEL_STEP * n * (n - 1) points: 0, 100, 300, 600, 1000, ...

ACHIEVEMENTS = [
    # id, title, description, rule counted, how many
    ("first_workout", "First workout", "Finish your first planned workout.", "workout", 1),
    ("ten_workouts", "Ten workouts", "Finish 10 planned workouts.", "workout", 10),
    ("full_week", "Full week", "Do every planned session in a week.", "full_week", 1),
    ("four_full_weeks", "Four full weeks", "Do every planned session in 4 different weeks.", "full_week", 4),
    ("well_rested", "Well rested", "Reach your sleep goal on 7 nights.", "sleep_goal", 7),
    ("on_plan", "On plan", "Eat within 10% of your calorie target on 7 days.", "nutrition", 7),
]


def level_for(total: int) -> tuple[int, int, int]:
    """(level, points where it started, points where the next one starts)."""
    level = 1
    while LEVEL_STEP * (level + 1) * level <= total:
        level += 1
    return level, LEVEL_STEP * level * (level - 1), LEVEL_STEP * (level + 1) * level


def _hm(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h} h {m:02d} min" if m else f"{h} h"


def _award(rule_id: str, key: str, day: dt.date, reason: str, source: str, user_id: int) -> PointAward:
    rule = RULES[rule_id]
    return PointAward(
        user_id=user_id, rule=rule_id, key=f"{rule_id}:{key}", points=rule.points, day=day, reason=reason,
        data_source=source,
    )


def candidate_awards(
    session: Session, user: User, profile: Profile, today: dt.date, tz_offset: int, existing: set[str]
) -> list[PointAward]:
    """Awards the user has earned in the lookback window and doesn't have yet."""
    start = max(today - dt.timedelta(days=LOOKBACK_DAYS - 1), local_date(user.created_at, tz_offset))
    if start > today:
        return []
    uid = user.id
    new: list[PointAward] = []

    def add(award: PointAward) -> None:
        if award.key not in existing:
            existing.add(award.key)
            new.append(award)

    # Workouts: one a day, up to the plan's sessions per week
    per_week = len(effective_training_days(profile))
    workout_days = sorted({w.day for w in completed_workouts(session, uid, week_start(start), today, tz_offset)})
    weeks: dict[dt.date, list[dt.date]] = {}
    for d in workout_days:
        weeks.setdefault(week_start(d), []).append(d)
    already: dict[dt.date, set[dt.date]] = {}  # workout points already given, by week
    for key in existing:
        if key.startswith("workout:"):
            d = dt.date.fromisoformat(key.split(":", 1)[1])
            already.setdefault(week_start(d), set()).add(d)
    for monday, days in weeks.items():
        awarded = already.setdefault(monday, set())
        for d in days:
            if len(awarded) >= per_week:
                break
            if d >= start and d not in awarded:
                add(_award("workout", str(d), d, "Finished a workout", "manual", uid))
                awarded.add(d)
        if len(awarded) >= per_week and monday + dt.timedelta(days=6) >= start:
            add(_award("full_week", str(monday), max(awarded), f"All {per_week} planned sessions this week", "manual", uid))

    # Sleep goal
    goal = sleep_goal(profile)
    for day, night in sleep_nights(session, uid, start, today).items():
        if night.duration_minutes < goal.minutes:
            continue
        if night.source == "manual" and local_date(night.created_at, tz_offset) > day + dt.timedelta(
            days=MANUAL_SLEEP_GRACE_DAYS
        ):
            continue  # logged long after the night: not counted
        source = "whoop" if night.source == "whoop" else "manual"
        add(_award("sleep_goal", str(day), day, f"Slept {_hm(night.duration_minutes)} (goal {_hm(goal.minutes)})", source, uid))

    # Eating to plan, for finished days only
    target = build_plan(profile).target_calories
    logs = session.exec(
        select(FoodLog).where(FoodLog.user_id == uid, FoodLog.date >= start, FoodLog.date < today)
    ).all()
    by_day: dict[dt.date, list[FoodLog]] = {}
    for log in logs:
        if local_date(log.created_at, tz_offset) <= log.date + dt.timedelta(days=1):
            by_day.setdefault(log.date, []).append(log)
    for day, day_logs in by_day.items():
        kcal = sum(x.calories for x in day_logs)
        if len(day_logs) >= NUTRITION_MIN_LOGS and abs(kcal - target) <= target * NUTRITION_TOLERANCE:
            add(_award("nutrition", str(day), day, f"Ate {round(kcal):,} kcal (target {round(target):,})", "manual", uid))

    # One weigh-in a week
    weigh_ins = session.exec(
        select(WeightEntry).where(WeightEntry.user_id == uid, WeightEntry.date >= start, WeightEntry.date <= today)
    ).all()
    for entry in sorted(weigh_ins, key=lambda e: e.date):
        add(_award("weigh_in", str(week_start(entry.date)), entry.date, "Weighed in this week", "manual", uid))

    return new


def evaluate(session: Session, user: User, profile: Profile, today: dt.date, tz_offset: int) -> list[PointAward]:
    """Give any points earned recently that haven't been given yet. Safe to call any number of times."""
    existing = set(session.exec(select(PointAward.key).where(PointAward.user_id == user.id)).all())
    new = candidate_awards(session, user, profile, today, tz_offset, existing)
    if not new:
        return []
    session.add_all(new)
    try:
        session.commit()
    except IntegrityError:  # another request gave the same points a moment ago
        session.rollback()
        return []
    return new


def achievements(awards: list[PointAward]) -> list[Achievement]:
    counts: dict[str, int] = {}
    for a in awards:
        counts[a.rule] = counts.get(a.rule, 0) + 1
    return [
        Achievement(id=i, title=title, description=desc, earned=counts.get(rule, 0) >= n,
                    progress=min(counts.get(rule, 0), n), target=n)
        for i, title, desc, rule, n in ACHIEVEMENTS
    ]
