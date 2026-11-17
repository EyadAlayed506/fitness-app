"""Personal insights: patterns in the user's own data, with how much data each one rests on.

Rules:
- A finding is only shown when each side has enough data (MIN_* below); otherwise the app says what
  more data would unlock it.
- Each comes with its sample sizes, and "clear" or "could be chance" from a simple two-sample test
  (Welch's t; |t| >= 2 counts as clear). Counts (like sessions done per weekday) are just counts.
- Nothing claims a cause: these are things that go together in this person's data.
"""

import datetime as dt
import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.food import FoodLog
from app.models.sleep import SleepEntry
from app.models.user import Profile, User, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from app.services.activity import local_date, sleep_goal
from app.services.calculations import estimated_1rm
from app.i18n import Table, tr, weekday_name
from app.services.schedule import effective_training_days

MIN_SESSIONS = 5  # per side, for sleep and strength
MIN_NIGHTS = 5  # per side, for sleep after training
MIN_WEEKS = 3  # per side, for food logging and weight
MIN_PLANNED = 4  # planned sessions per weekday, for follow-through
LOOKBACK_DAYS = 120

# What the user reads, in the language of the request (app.i18n). Group units: "min" is an ID the app formats;
# the others are shown as they are.
TEXTS: Table = {
    "en": {
        "caution": "From your own data, side by side. It doesn't show that one causes the other.",
        "h": "{h} h",
        "hm": "{h} h {m}",
        "pct_usual": "% of usual",
        "done": "done",
        "per_week": "{unit}/week",
        "kg": "kg",
        "lb": "lb",
        "ss_label": "Sleep and strength (nights of {goal}+ vs shorter)",
        "ss_needs": "{label}: needs {min} workouts after each kind of night with sleep logged (you have {a} and {b}).",
        "ss_same": "Your top sets were about the same after nights of {goal}+ sleep as after shorter nights ({a} vs {b} sessions).",
        "ss_heavier": "Your top sets were {pct}% heavier after nights of {goal}+ sleep ({a} vs {b} sessions).",
        "ss_lighter": "Your top sets were {pct}% lighter after nights of {goal}+ sleep ({a} vs {b} sessions).",
        "ss_title": "Sleep and strength",
        "ss_after_goal": "After {goal}+ sleep",
        "ss_after_short": "After shorter nights",
        "sat_title": "Sleep after training days",
        "sat_needs": "{label}: needs {min} nights after training days and {min} after rest days (you have {a} and {b}).",
        "sat_same": "You slept about the same after training days as after rest days ({a} vs {b} nights).",
        "sat_longer": "You slept {d} min longer after training days than after rest days ({a} vs {b} nights).",
        "sat_less": "You slept {d} min less after training days than after rest days ({a} vs {b} nights).",
        "sat_after_training": "After training",
        "sat_after_rest": "After rest days",
        "wd_needs": "Training days: needs {min} weeks of plan on at least two training days to compare them.",
        "wd_same": "You do your planned sessions about as often on every training day (best {day}, {done} of {total}).",
        "wd_diff": "You did {done} of {total} planned {day} sessions, but {low_done} of {low_total} on {low_day}s.",
        "wd_title": "Which training days happen",
        "wd_caution": "Counts of your planned days in the last 8 weeks.",
        "lw_title": "Food logging and weight",
        "lw_needs": "{label}: needs {min} weeks with food logged on 5+ days and {min} with fewer, all with weigh-ins (you have {a} and {b}).",
        "lw_text": "In weeks you logged food on 5+ days your weight changed {a} a week on average, vs {b} in other weeks ({na} vs {nb} weeks).",
        "lw_most": "Logged 5+ days",
        "lw_fewer": "Fewer days",
    },
    "ar": {
        "caution": "من بياناتك أنت، جنباً إلى جنب. ولا يعني ذلك أن أحدهما سبب للآخر.",
        "h": "{h} س",
        "hm": "{h} س {m}",
        "pct_usual": "% من المعتاد",
        "done": "مُنجزة",
        "per_week": "{unit}/أسبوع",
        "kg": "كغ",
        "lb": "رطل",
        "ss_label": "النوم والقوة (ليالي {goal}+ مقابل الأقصر)",
        "ss_needs": "{label}: يحتاج {min} تمارين بعد كل نوع من الليالي مع تسجيل النوم (لديك {a} و{b}).",
        "ss_same": "كانت أفضل مجموعاتك متقاربة بعد ليالي نوم {goal}+ وبعد الليالي الأقصر ({a} مقابل {b} حصص).",
        "ss_heavier": "كانت أفضل مجموعاتك أثقل بنسبة {pct}% بعد ليالي نوم {goal}+ ({a} مقابل {b} حصص).",
        "ss_lighter": "كانت أفضل مجموعاتك أخف بنسبة {pct}% بعد ليالي نوم {goal}+ ({a} مقابل {b} حصص).",
        "ss_title": "النوم والقوة",
        "ss_after_goal": "بعد نوم {goal}+",
        "ss_after_short": "بعد ليالٍ أقصر",
        "sat_title": "النوم بعد أيام التمرين",
        "sat_needs": "{label}: يحتاج {min} ليالٍ بعد أيام التمرين و{min} بعد أيام الراحة (لديك {a} و{b}).",
        "sat_same": "نمت مدة متقاربة بعد أيام التمرين وبعد أيام الراحة ({a} مقابل {b} ليالٍ).",
        "sat_longer": "نمت أكثر بـ {d} د بعد أيام التمرين مقارنة بأيام الراحة ({a} مقابل {b} ليالٍ).",
        "sat_less": "نمت أقل بـ {d} د بعد أيام التمرين مقارنة بأيام الراحة ({a} مقابل {b} ليالٍ).",
        "sat_after_training": "بعد التمرين",
        "sat_after_rest": "بعد أيام الراحة",
        "wd_needs": "أيام التمرين: يحتاج {min} أسابيع من الخطة في يومي تمرين على الأقل للمقارنة بينهما.",
        "wd_same": "تؤدي حصصك المخططة بانتظام متقارب في كل أيام التمرين (الأفضل {day}، {done} من {total}).",
        "wd_diff": "أدّيت {done} من {total} حصص {day} المخططة، لكن {low_done} من {low_total} في أيام {low_day}.",
        "wd_title": "أي أيام التمرين تتحقق",
        "wd_caution": "أعداد أيامك المخططة في آخر 8 أسابيع.",
        "lw_title": "تسجيل الطعام والوزن",
        "lw_needs": "{label}: يحتاج {min} أسابيع سجّلت فيها طعامك 5 أيام أو أكثر و{min} أسابيع أقل، وكلها مع وزن مسجّل (لديك {a} و{b}).",
        "lw_text": "في الأسابيع التي سجّلت فيها طعامك 5 أيام أو أكثر تغيّر وزنك {a} أسبوعياً في المتوسط، مقابل {b} في الأسابيع الأخرى ({na} مقابل {nb} أسابيع).",
        "lw_most": "سُجّل 5 أيام أو أكثر",
        "lw_fewer": "أيام أقل",
    },
}

# The English caution, for code that reads it directly
CAUTION = TEXTS["en"]["caution"]


def caution() -> str:
    return tr(TEXTS, "caution")


def _plain(text: str) -> str:
    """Without the invisible direction marks: for pieces that go inside other texts."""
    return text.replace("\u2068", "").replace("\u2069", "")


@dataclass
class Group:
    label: str
    n: int
    value: float
    unit: str


@dataclass
class Finding:
    id: str
    title: str
    text: str
    groups: list[Group]
    strength: str  # "clear", "could be chance", or "count"
    caution: str = field(default_factory=caution)


@dataclass
class Result:
    findings: list[Finding] = field(default_factory=list)
    not_enough: list[str] = field(default_factory=list)


def welch_t(a: list[float], b: list[float]) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    va, vb = statistics.variance(a), statistics.variance(b)
    se = math.sqrt(va / len(a) + vb / len(b))
    return (statistics.mean(a) - statistics.mean(b)) / se if se > 0 else 0.0


def strength_of(a: list[float], b: list[float]) -> str:
    return "clear" if abs(welch_t(a, b)) >= 2 else "could be chance"


def _hours(minutes: int) -> str:
    if minutes % 60 == 0:
        return _plain(tr(TEXTS, "h", h=minutes // 60))
    return _plain(tr(TEXTS, "hm", h=minutes // 60, m=f"{minutes % 60:02d}"))


def compute(session: Session, user: User, profile: Profile, today: dt.date, tz_offset: int | None) -> Result:
    result = Result()
    since = today - dt.timedelta(days=LOOKBACK_DAYS)
    imperial = profile.unit_system == "imperial"

    # finished workouts with their sets, by local date
    rows = session.exec(
        select(WorkoutSet, WorkoutSession)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(WorkoutSession.user_id == user.id, WorkoutSession.ended_at.is_not(None))
    ).all()
    workouts: dict[int, dict] = {}
    for s, w in rows:
        day = local_date(w.started_at, tz_offset)
        if day < since:
            continue
        info = workouts.setdefault(w.id, {"day": day, "best": {}})
        e1rm = estimated_1rm(s.weight_kg, s.reps)
        if e1rm > info["best"].get(s.exercise_id, 0):
            info["best"][s.exercise_id] = e1rm
    trained_days = {w["day"] for w in workouts.values()}

    sleep_minutes: dict[dt.date, int] = defaultdict(int)  # night ending on that morning
    for e in session.exec(select(SleepEntry).where(SleepEntry.user_id == user.id, SleepEntry.date >= since)).all():
        sleep_minutes[e.date] += e.duration_minutes
    goal = sleep_goal(profile).minutes

    _sleep_and_strength(result, workouts, sleep_minutes, goal)
    _sleep_after_training(result, sleep_minutes, trained_days)
    _weekday_follow_through(result, profile, user, trained_days, today, tz_offset)
    _logging_and_weight(result, session, user, today, imperial)
    return result


def _sleep_and_strength(result: Result, workouts: dict[int, dict], sleep_minutes: dict, goal: int) -> None:
    """Top sets (each exercise against its own usual level) after nights at the sleep goal vs shorter ones."""
    per_exercise: dict[int, list[float]] = defaultdict(list)
    for w in workouts.values():
        for ex, v in w["best"].items():
            if v > 0:
                per_exercise[ex].append(v)
    usual = {ex: statistics.median(vs) for ex, vs in per_exercise.items() if len(vs) >= 3}
    rested, short = [], []
    for w in workouts.values():
        ratios = [v / usual[ex] for ex, v in w["best"].items() if ex in usual and v > 0]
        night = sleep_minutes.get(w["day"])
        if not ratios or night is None:
            continue
        (rested if night >= goal else short).append(statistics.mean(ratios))
    label = _plain(tr(TEXTS, "ss_label", goal=_hours(goal)))
    if len(rested) < MIN_SESSIONS or len(short) < MIN_SESSIONS:
        result.not_enough.append(tr(TEXTS, "ss_needs", label=label, min=MIN_SESSIONS, a=len(rested), b=len(short)))
        return
    a, b = statistics.mean(rested), statistics.mean(short)
    diff = (a / b - 1) * 100
    counts = {"goal": _hours(goal), "a": len(rested), "b": len(short)}
    if abs(diff) < 0.5:
        text = tr(TEXTS, "ss_same", **counts)
    else:
        text = tr(TEXTS, "ss_heavier" if diff > 0 else "ss_lighter", pct=f"{abs(diff):.0f}", **counts)
    pct = tr(TEXTS, "pct_usual")
    result.findings.append(Finding(
        "sleep_strength",
        tr(TEXTS, "ss_title"),
        text,
        [Group(_plain(tr(TEXTS, "ss_after_goal", goal=_hours(goal))), len(rested), round(a * 100, 1), pct),
         Group(tr(TEXTS, "ss_after_short"), len(short), round(b * 100, 1), pct)],
        strength_of(rested, short),
    ))


def _sleep_after_training(result: Result, sleep_minutes: dict, trained_days: set) -> None:
    after_training, after_rest = [], []
    for morning, minutes in sleep_minutes.items():
        (after_training if morning - dt.timedelta(days=1) in trained_days else after_rest).append(minutes)
    label = tr(TEXTS, "sat_title")
    if len(after_training) < MIN_NIGHTS or len(after_rest) < MIN_NIGHTS:
        result.not_enough.append(tr(TEXTS, "sat_needs", label=label, min=MIN_NIGHTS, a=len(after_training), b=len(after_rest)))
        return
    a, b = statistics.mean(after_training), statistics.mean(after_rest)
    diff = round(a - b)
    counts = {"a": len(after_training), "b": len(after_rest)}
    text = (
        tr(TEXTS, "sat_same", **counts)
        if abs(diff) < 3
        else tr(TEXTS, "sat_longer" if diff > 0 else "sat_less", d=abs(diff), **counts)
    )
    result.findings.append(Finding(
        "sleep_after_training",
        label,
        text,
        [Group(tr(TEXTS, "sat_after_training"), len(after_training), round(a), "min"),
         Group(tr(TEXTS, "sat_after_rest"), len(after_rest), round(b), "min")],
        strength_of(after_training, after_rest),
    ))


def _weekday_follow_through(result: Result, profile: Profile, user: User, trained_days: set, today: dt.date, tz_offset: int | None) -> None:
    start = max(local_date(user.created_at, tz_offset), today - dt.timedelta(weeks=8))
    rates = []
    for weekday in effective_training_days(profile):
        planned = [start + dt.timedelta(days=i) for i in range((today - start).days)
                   if (start + dt.timedelta(days=i)).weekday() == weekday]
        if len(planned) >= MIN_PLANNED:
            done = sum(d in trained_days for d in planned)
            rates.append((done / len(planned), weekday, done, len(planned)))
    if len(rates) < 2:
        result.not_enough.append(tr(TEXTS, "wd_needs", min=MIN_PLANNED))
        return
    rates.sort()
    low, high = rates[0], rates[-1]
    if high[0] - low[0] < 0.3:
        text = tr(TEXTS, "wd_same", day=weekday_name(high[1]), done=high[2], total=high[3])
    else:
        text = tr(TEXTS, "wd_diff", done=high[2], total=high[3], day=weekday_name(high[1]),
                  low_done=low[2], low_total=low[3], low_day=weekday_name(low[1]))
    done = tr(TEXTS, "done")
    result.findings.append(Finding(
        "weekday_follow_through",
        tr(TEXTS, "wd_title"),
        text,
        [Group(weekday_name(high[1]), high[3], high[2], done), Group(weekday_name(low[1]), low[3], low[2], done)],
        "count",
        caution=tr(TEXTS, "wd_caution"),
    ))


def _logging_and_weight(result: Result, session: Session, user: User, today: dt.date, imperial: bool) -> None:
    this_monday = today - dt.timedelta(days=today.weekday())
    weeks = [this_monday - dt.timedelta(weeks=k) for k in range(12, 0, -1)]  # complete weeks only
    logged = defaultdict(set)
    for d in session.exec(select(FoodLog.date).where(FoodLog.user_id == user.id, FoodLog.date >= weeks[0])).all():
        logged[d - dt.timedelta(days=d.weekday())].add(d)
    weigh_ins = sorted(session.exec(select(WeightEntry.date, WeightEntry.weight_kg).where(WeightEntry.user_id == user.id)).all())

    def last_before(day: dt.date) -> float | None:
        before = [w for d, w in weigh_ins if d < day]
        return before[-1] if before else None

    most, fewer = [], []
    for monday in weeks:
        end = monday + dt.timedelta(days=7)
        start_w = last_before(monday)
        if start_w is None or not any(monday <= d < end for d, _ in weigh_ins):
            continue  # needs a weigh-in before the week and one during it
        change = last_before(end) - start_w
        (most if len(logged[monday]) >= 5 else fewer).append(change)
    label = tr(TEXTS, "lw_title")
    if len(most) < MIN_WEEKS or len(fewer) < MIN_WEEKS:
        result.not_enough.append(tr(TEXTS, "lw_needs", label=label, min=MIN_WEEKS, a=len(most), b=len(fewer)))
        return
    factor = 1 / 0.45359237 if imperial else 1
    unit = tr(TEXTS, "lb" if imperial else "kg")
    a, b = statistics.mean(most) * factor, statistics.mean(fewer) * factor
    fmt = lambda v: f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.1f} {unit}"  # noqa: E731
    result.findings.append(Finding(
        "logging_weight",
        label,
        tr(TEXTS, "lw_text", a=fmt(a), b=fmt(b), na=len(most), nb=len(fewer)),
        [Group(tr(TEXTS, "lw_most"), len(most), round(a, 2), _plain(tr(TEXTS, "per_week", unit=unit))),
         Group(tr(TEXTS, "lw_fewer"), len(fewer), round(b, 2), _plain(tr(TEXTS, "per_week", unit=unit)))],
        strength_of(most, fewer),
    ))
