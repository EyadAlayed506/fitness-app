import type { Profile } from "./types";

/** Full profile body for PUT /me/profile, from the saved profile plus a few changes. */
export function profilePayload(p: Profile, changes: Partial<Record<string, unknown>> = {}) {
  return {
    birth_date: p.birth_date,
    sex: p.sex,
    height: p.height_cm,
    height_unit: "cm",
    weight: p.weight_kg,
    weight_unit: "kg",
    activity_level: p.activity_level,
    goal: p.goal,
    diet_option: p.diet_option,
    days_per_week: p.days_per_week,
    minutes_per_session: p.minutes_per_session,
    equipment: p.equipment,
    unit_system: p.unit_system,
    rest_seconds: p.rest_seconds,
    ...changes,
  };
}
