"""What a gym has, and which exercises from the catalogue that allows ("photograph a gym").

Machines are matched one by one (each machine is an exercise in the catalogue). Everything else comes
from a few kinds of equipment. Bodyweight exercises that need nothing are always possible.
"""

from app.models.exercise import Exercise

# kinds of equipment besides machines, in the order the app lists them
EQUIPMENT_LABELS = {
    "dumbbells": "Dumbbells",
    "barbell": "Barbell and rack",
    "cable_station": "Cable station",
    "pull_up_bar": "Pull-up bar",
}


def needs(ex: Exercise) -> str | None:
    """What an exercise needs besides the user: "machine", an equipment key, or None (nothing)."""
    if ex.category == "machine":
        return "machine"
    if ex.category == "cable":
        return "cable_station"
    if ex.category == "free weight":
        return "barbell" if ex.equipment == "gym" else "dumbbells"
    if ex.pattern in ("vertical_pull", "horizontal_pull"):  # pull-ups, chin-ups, inverted rows
        return "pull_up_bar"
    return None


def possible(catalogue: list[Exercise], machine_ids: set[int], equipment: set[str]) -> list[Exercise]:
    """The exercises this gym allows."""
    out = []
    for ex in catalogue:
        need = needs(ex)
        if need is None or (need == "machine" and ex.id in machine_ids) or need in equipment:
            out.append(ex)
    return out
