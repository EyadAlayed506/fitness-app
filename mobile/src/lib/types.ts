// Shapes of the backend's JSON responses (see the API docs at /docs).

export type Sex = "male" | "female";
export type UnitSystem = "metric" | "imperial";

export interface User {
  id: number;
  email: string;
  marketing_opt_in: boolean;
  created_at: string;
  has_profile: boolean;
}

export interface Profile {
  birth_date: string;
  sex: Sex;
  activity_level: string;
  goal: string;
  diet_option: string;
  days_per_week: number;
  minutes_per_session: number;
  equipment: string;
  unit_system: UnitSystem;
  height_cm: number;
  weight_kg: number;
  age: number;
  training_days: number[]; // 0 = Monday ... 6 = Sunday
  training_days_chosen: boolean; // false: filled in automatically for an older profile
  sleep_goal_minutes: number | null;
}

export interface DietOption {
  option: string;
  calories: number;
  difference: number;
  weekly_change_kg: number;
  weeks_to_target: number | null;
  capped: boolean;
  warning: string | null;
  selected: boolean;
}

export interface Plan {
  age: number;
  weight_kg: number;
  height_cm: number;
  bmi: number;
  bmi_category: "underweight" | "normal" | "overweight" | "obese";
  healthy_weight_min_kg: number;
  healthy_weight_max_kg: number;
  optimal_weight_kg: number;
  weight_change_kg: number;
  change_to_healthy_range_kg: number;
  direction: "lose" | "maintain" | "gain";
  bmr: number;
  tdee: number;
  options: DietOption[];
  target_calories: number;
  disclaimer: string;
}

export interface RoutineExercise {
  exercise_id: number;
  name: string;
  muscle_group: string;
  sets: number;
  reps: string;
  rest_seconds: number;
}

export interface Routine {
  split: string;
  split_reason: string;
  training_days: number[];
  rest_days: string[];
  days_per_week: number;
  minutes_per_session: number;
  exercises_per_day: number;
  reps: string;
  days: RoutineDay[];
  notes: string[];
  /** the user changed a session type or named a day */
  customized: boolean;
  recommended_split: string;
  /** friendly notes about the plan (never block saving) */
  warnings: string[];
  focus_options: { value: string; label: string }[];
}

export interface RoutineDay {
  weekday: string;
  weekday_index: number;
  /** the user's own name for the day, or the session type */
  title: string;
  focus: string;
  focus_label: string;
  recommended_focus: string;
  custom_name: boolean;
  exercises: RoutineExercise[];
  cardio_minutes: number;
}

export interface Exercise {
  id: number;
  name: string;
  aliases: string;
  category: string;
  muscle_group: string;
  primary_muscles: string;
  equipment: string;
  qr_code: string;
  /** Movement pattern, e.g. "squat"; used to find like-for-like alternatives. */
  pattern: string | null;
  /** Short how-to cues from the curated library (empty when there are none). */
  instructions: string[];
  default_rest_seconds: number;
}

export interface ExerciseAlternative {
  exercise: Exercise;
  /** "similar": same movement; "different": same muscles, another movement (not a like-for-like swap). */
  match: "similar" | "different";
  reasons: string[];
  differences: string[];
}

export interface ExerciseAlternatives {
  exercise: Exercise;
  equipment: string | null;
  filtered_by_equipment: boolean;
  alternatives: ExerciseAlternative[];
}

export interface RestSetting {
  exercise_id: number;
  default_seconds: number;
  preferred_seconds: number | null;
  seconds: number;
}

export interface WorkoutSet {
  id: number;
  exercise_id: number;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  rpe: number | null;
  rest_seconds: number | null;
  notes: string;
  added_via: "name" | "qr" | "photo";
}

export interface Workout {
  id: number;
  started_at: string;
  ended_at: string | null;
  notes: string;
  set_count: number;
  volume_kg: number;
  sets: WorkoutSet[];
}

export interface Nutrients {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
  added_sugar_g?: number | null;
  saturated_fat_g?: number | null;
  trans_fat_g?: number | null;
  cholesterol_mg?: number | null;
  sodium_mg?: number | null;
  potassium_mg?: number | null;
}

export interface Food extends Nutrients {
  id: number;
  name: string;
  brand: string;
  is_liquid: boolean;
  serving_size: number | null;
  serving_unit: string | null;
  source: "builtin" | "usda" | "off" | "manual";
  owner_id: number | null;
}

/** A food found online, not saved yet. */
export interface FoodCandidate extends Omit<Food, "id" | "owner_id"> {
  external_id: string;
}

export interface FoodSearch {
  local: Food[];
  online: FoodCandidate[];
  warnings: string[];
}

export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodLogEntry {
  id: number;
  food_id: number;
  food_name: string;
  date: string;
  meal: Meal;
  quantity: number;
  unit: string;
  amount_base: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface Totals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface FoodDay {
  date: string;
  entries: FoodLogEntry[];
  totals: Totals;
  target_calories: number | null;
}

export interface SeriesData {
  name: string;
  data: (number | null)[];
}

export interface WeightAnalytics {
  labels: string[];
  series: SeriesData[];
  target_weight_kg: number | null;
  healthy_range_kg: [number, number] | null;
}

export interface Projection {
  labels: number[];
  series: (SeriesData & { calories: number; reaches_target_week: number | null; final_weight_kg: number })[];
  target_weight_kg: number;
  note: string;
}

export interface CalorieAnalytics {
  labels: string[];
  series: SeriesData[];
  macros: SeriesData[];
  target_calories: number | null;
}

export interface ExerciseProgress {
  exercise: string;
  labels: string[];
  series: SeriesData[];
  volume: number[];
}

export interface MeasurementCompare {
  months: string[];
  available_months: string[];
  rows: { field: string; label: string; first: number | null; second: number | null; difference: number | null }[];
}

export interface SleepEntry {
  id: number;
  date: string;
  bedtime: string; // local clock time, no timezone: "2026-10-10T23:30:00"
  wake_time: string;
  duration_minutes: number;
  quality: number | null;
  notes: string;
  source: "manual" | "whoop";
  // from WHOOP
  light_minutes?: number | null;
  deep_minutes?: number | null;
  rem_minutes?: number | null;
  awake_minutes?: number | null;
  performance_pct?: number | null;
  recovery_score?: number | null;
}

export interface WhoopStatus {
  configured: boolean;
  /** register exactly this redirect URL in the WHOOP developer dashboard */
  redirect_uri: string;
  connected: boolean;
  whoop_name: string;
  connected_at: string | null;
  last_sync_at: string | null;
}

export interface WhoopSyncResult {
  imported: number;
  updated: number;
  replaced_manual: number;
  skipped: boolean;
  last_sync_at: string | null;
}

export interface SleepNight {
  /** total for the night including naps */
  minutes: number;
  main_minutes: number;
  bedtime: string;
  wake_time: string;
  source: "manual" | "whoop";
  quality: number | null;
  /** only when a tracker measured them; never estimated for manual logs */
  stages: { light: number | null; deep: number | null; rem: number | null; awake: number | null } | null;
  recovery_score: number | null;
  /** earned sleep-goal points */
  points: boolean;
}

export interface SleepAnalytics {
  labels: string[];
  series: SeriesData[];
  quality: (number | null)[];
  /** one per label; null = not logged */
  nights: (SleepNight | null)[];
  average_hours_7d: number | null;
  average_quality_7d: number | null;
  nights_logged_7d: number;
  /** null unless both weeks have enough nights to compare */
  average_hours_prev_7d: number | null;
  nights_logged_prev_7d: number;
  nights_at_goal_7d: number;
  goal_minutes: number;
  goal_custom: boolean;
  recommended_hours: [number, number];
  bedtime_spread_minutes: number | null;
  wake_spread_minutes: number | null;
}

export interface Recommendation {
  id: string;
  kind: "plan" | "rest" | "lighter" | "progress" | "info";
  title: string;
  message: string;
  reasons: string[];
  sources: string[];
}

export interface Recommendations {
  date: string;
  items: Recommendation[];
  disclaimer: string;
}

export interface PointAward {
  rule: string;
  points: number;
  day: string;
  reason: string;
  /** "manual": entered by the user; "whoop": from a connected tracker */
  data_source: "manual" | "whoop";
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  progress: number;
  target: number;
}

export interface Points {
  total: number;
  level: number;
  level_start: number;
  next_level_at: number;
  today: { date: string; points: number; awards: PointAward[] };
  /** Points given by this request */
  new: PointAward[];
  recent: PointAward[];
  achievements: Achievement[];
  rules: { id: string; points: number; label: string; description: string }[];
}

export interface TopSet {
  weight_kg: number;
  reps: number;
  date: string;
}

export interface WeeklySummary {
  week_start: string;
  week_end: string;
  current_week: boolean;
  days: { date: string; planned: boolean; trained: boolean; future: boolean }[];
  planned: number;
  planned_so_far: number;
  completed: number;
  completed_on_plan: number;
  workouts: number;
  previous_completed: number | null;
  sets: number;
  volume_kg: number;
  previous_volume_kg: number | null;
  exercises: {
    exercise_id: number;
    name: string;
    sets: number;
    top_set: TopSet;
    previous_top_set: TopSet | null;
    best_e1rm_kg: number | null;
    previous_e1rm_kg: number | null;
    record: string | null;
  }[];
  records: string[];
  sleep: {
    nights_logged: number;
    average_minutes: number;
    goal_minutes: number;
    nights_meeting_goal: number;
    from_whoop: number;
    logged_by_hand: number;
    previous_average_minutes: number | null;
    previous_nights_logged: number;
  } | null;
  weight: {
    latest_kg: number;
    previous_latest_kg: number | null;
    change_kg: number | null;
    target_kg: number;
    direction: "lose" | "gain" | "maintain";
    to_target_kg: number;
  } | null;
  points: number;
  previous_points: number;
  history: { week_start: string; planned: number; completed: number }[];
  notes: string[];
}

export interface AssistantAction {
  kind: "food" | "sets" | "weight" | "sleep" | "removed";
  summary: string;
  /** app route where the change shows up */
  screen: string;
  /** API paths to DELETE to undo it */
  undo: string[];
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** tools the assistant used to look at the user's data */
  tools_used: string[];
  /** what the assistant added or removed */
  actions: AssistantAction[];
  created_at: string;
}

export interface AssistantStatus {
  configured: boolean;
  /** why the assistant can't answer yet, and how to fix it */
  problem: string | null;
  /** "ollama": a free model on the user's PC; "claude": Anthropic's API (paid) */
  provider: "claude" | "ollama";
  model: string;
  /** null: no limit (local model) */
  messages_left_today: number | null;
  messages: ChatMessage[];
  disclaimer: string;
}

export interface ChatReply {
  question: ChatMessage;
  answer: ChatMessage;
  messages_left_today: number | null;
}

// ---------- faster logging ----------

export interface ExerciseHistory {
  exercise_id: number;
  /** the most recent other workout with this exercise */
  last: { workout_id: number; started_at: string; sets: { reps: number; weight_kg: number; rpe: number | null }[] } | null;
  /** best set ever: highest estimated 1RM, or most reps if never with weight */
  best: { weight_kg: number; reps: number; e1rm_kg: number; started_at: string } | null;
}

export interface RecentFood {
  food: Food;
  quantity: number;
  unit: string;
  meal: Meal;
  times: number;
  last_date: string;
}

export interface RecentFoods {
  recent: RecentFood[];
  frequent: RecentFood[];
}

export interface PlanPreview {
  plan: Plan;
  routine: Routine;
}

export interface GettingStarted {
  signed_up: string;
  days_since_signup: number;
  first_weigh_in: string | null;
  weighed_in: boolean;
  logged_food: boolean;
  finished_workout: boolean;
  sleep_goal_set: boolean;
}
