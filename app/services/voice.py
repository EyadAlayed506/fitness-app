"""Hands-free workout commands: the AI fallback for words the app's own parser couldn't read.

The app understands most commands itself, offline ("12 reps at 25 kilos", "rest 30 seconds"). Only when it
can't does it send the words (never audio) here, and the AI turns them into the same structured command. The
answer is checked like everything else, and a set read by the AI is confirmed by the user before it's saved.
"""

from typing import Any

INTENTS = (
    "log_set", "same_again", "next_set", "rest_start", "rest_set_total", "rest_extend", "rest_cancel", "rest_query",
    "rest_default", "note", "correct_last", "delete_last", "sets_left", "next_exercise", "switch_exercise",
    "stop_listening", "finish_workout", "unknown",
)

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": list(INTENTS)},
        "exercise": {"type": ["string", "null"]},
        "set_number": {"type": ["integer", "null"]},
        "reps": {"type": ["integer", "null"]},
        "weight": {"type": ["number", "null"]},
        "unit": {"type": ["string", "null"], "enum": ["kg", "lb", None]},
        "seconds": {"type": ["integer", "null"]},
        "text": {"type": ["string", "null"]},
    },
    "required": ["intent", "exercise", "set_number", "reps", "weight", "unit", "seconds", "text"],
}

PROMPT = """You turn one spoken command from someone in the middle of a gym workout into JSON. The app does it.

Context: the exercise being done is {current}. Exercises in today's plan: {plan}. The user's weight unit is {unit}.

Intents:
- log_set: a set was done. exercise (only if they named one), set_number ("first set" = 1), reps, weight, unit.
- same_again: repeat the last set. next_set: ready for the next set. next_exercise: move on to the next exercise.
- switch_exercise: they're now doing the named exercise (exercise).
- rest_start (seconds, or null for the usual rest), rest_set_total (the current rest should last seconds in total),
  rest_extend (add seconds to the current rest; negative to take time off), rest_cancel, rest_query (time left),
  rest_default (the usual rest from now on, seconds).
- note: something to write down; text = their words, unchanged.
- correct_last: change the last set (reps and/or weight). delete_last: delete the last set.
- sets_left: how many sets are left. finish_workout. stop_listening: turn hands-free off.
- unknown: anything else, or if you're not sure.

Use only numbers they said; never make one up (use null). Words: "{text}"
"""

MAX_REPS, MAX_KG, MAX_SECONDS = 100, 500, 600


def _int(value: Any) -> int | None:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def clean_command(raw: Any) -> dict | None:
    """The AI's answer as the app's command, or None when it isn't a usable one. Out-of-range numbers are dropped."""
    if not isinstance(raw, dict) or raw.get("intent") not in INTENTS or raw.get("intent") == "unknown":
        return None
    intent = raw["intent"]
    unit = raw.get("unit") if raw.get("unit") in ("kg", "lb") else None
    reps = _int(raw.get("reps"))
    reps = reps if reps is not None and 1 <= reps <= MAX_REPS else None
    try:
        weight = float(raw["weight"]) if raw.get("weight") is not None else None
    except (TypeError, ValueError):
        weight = None
    if weight is not None and not 0 <= (weight * 0.4536 if unit == "lb" else weight) <= MAX_KG:
        weight = None
    seconds = _int(raw.get("seconds"))
    seconds = seconds if seconds is not None and 0 < abs(seconds) <= MAX_SECONDS else None
    exercise = str(raw.get("exercise") or "").strip()[:80] or None
    text = str(raw.get("text") or "").strip()[:300]

    if intent == "log_set":
        if reps is None and weight is None:
            return None
        set_number = _int(raw.get("set_number"))
        return {"intent": intent, "exercise": exercise, "setNumber": set_number if set_number and 1 <= set_number <= 20 else None,
                "count": 1, "reps": reps, "weight": weight, "unit": unit, "bodyweight": weight == 0}
    if intent == "correct_last":
        return {"intent": intent, "reps": reps, "weight": weight, "unit": unit} if reps is not None or weight is not None else None
    if intent in ("rest_set_total", "rest_extend", "rest_default"):
        if seconds is None or (intent != "rest_extend" and seconds < 0):
            return None
        return {"intent": intent, "seconds": seconds}
    if intent == "rest_start":
        return {"intent": intent, "seconds": seconds if seconds and seconds > 0 else None}
    if intent == "note":
        return {"intent": intent, "text": text} if text else None
    if intent == "switch_exercise":
        return {"intent": intent, "exercise": exercise} if exercise else None
    return {"intent": intent}


def prompt_for(text: str, current: str | None, plan: list[str], unit: str) -> str:
    return PROMPT.format(
        current=current or "not chosen yet", plan=", ".join(plan) or "none (a free workout)",
        unit=unit, text=text.replace('"', "'"),
    )
