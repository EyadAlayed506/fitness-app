/* Fitness App - web preview of the mobile app. Talks to the FastAPI backend under /api. */
"use strict";

// ---------------------------------------------------------------- helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round = (n, d = 0) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const fmt = (n, d = 0) => (n == null ? "–" : round(n, d).toLocaleString(undefined, { maximumFractionDigits: d }));
const todayISO = () => isoDate(new Date());
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const shortDate = (s) => parseISO(s.slice(0, 10)).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (s) => parseISO(s.slice(0, 10)).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = { token: store.get("token"), me: null, profile: null, plan: null };

// ---------------------------------------------------------------- units

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const MASS_TO_G = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
const VOLUME_TO_ML = { ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, fl_oz: 29.5735295625, cup: 236.5882365, pint: 473.176473, quart: 946.352946, gallon: 3785.411784 };
const unitLabel = (u) => ({ fl_oz: "fl oz", serving: "serving" }[u] || u);

const imperial = () => state.profile?.unit_system === "imperial";
const wUnit = () => (imperial() ? "lb" : "kg");
const fromKg = (kg) => (kg == null ? null : imperial() ? kg / KG_PER_LB : kg);
const toKg = (v, unit) => (unit === "lb" ? v * KG_PER_LB : v);
const fmtW = (kg, d = 1) => (kg == null ? "–" : `${fmt(fromKg(kg), d)} ${wUnit()}`);
const fmtWDelta = (kg, d = 1) => (kg == null ? "–" : `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${fmt(Math.abs(fromKg(kg)), d)} ${wUnit()}`);
const lUnit = () => (imperial() ? "in" : "cm");
const fromCm = (cm) => (cm == null ? null : imperial() ? cm / CM_PER_IN : cm);

function baseAmount(food, quantity, unit) {
  if (unit === "serving") return quantity * baseAmount(food, food.serving_size, food.serving_unit);
  const table = food.is_liquid ? VOLUME_TO_ML : MASS_TO_G;
  return table[unit] ? quantity * table[unit] : null;
}

// ---------------------------------------------------------------- API

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let payload;
  if (form) { payload = new URLSearchParams(form); }
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && state.token) { logout(); throw new ApiError(401, "Your session expired. Please log in again."); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorText(data) || `Request failed (${res.status})`);
  return data;
}

function errorText(data) {
  if (!data?.detail) return null;
  if (typeof data.detail === "string") return data.detail;
  return data.detail.map((d) => `${d.loc?.slice(-1)[0] ?? ""}: ${d.msg}`).join("; ");
}

function toast(msg) {
  $(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

/** Navigate to a page. Setting the same hash fires no hashchange, so render directly then. */
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function logout() {
  state.token = null; state.me = null; state.profile = null; state.plan = null;
  store.set("token", null);
  go("#/login");
}

async function loadMe() {
  state.me = await api("/me");
  state.profile = state.me.has_profile ? await api("/me/profile") : null;
  state.plan = state.profile ? await api("/me/plan") : null;
}

async function refreshPlan() {
  state.profile = await api("/me/profile");
  state.plan = await api("/me/plan");
}

// ---------------------------------------------------------------- layout

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  workouts: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8M3 3v8a2 2 0 0 0 2 2M17 21V3c2.2 0 4 2.5 4 6s-1.8 5-4 5"/>',
  progress: '<path d="M3 20h18M6 16l4-5 3 3 5-7"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
};
const TABS = [["home", "Home"], ["workouts", "Workouts"], ["food", "Food"], ["progress", "Progress"], ["profile", "Profile"]];

function svgIcon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function shell(tab, title, sub, content, headerRight = "") {
  destroyCharts();
  $("#app").innerHTML = `
    <header class="top">
      <div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>
      ${headerRight}
    </header>
    <main>${content}</main>
    <nav class="tabs">${TABS.map(([id, label]) =>
      `<a href="#/${id}" class="${id === tab ? "on" : ""}" ${id === tab ? 'aria-current="page"' : ""}>${svgIcon(id)}<span>${label}</span></a>`).join("")}
    </nav>`;
  window.scrollTo(0, 0);
}

function openSheet(title, html, onClose) {
  closeSheet();
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grabber"></div>
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="btn ghost small" data-close>Close</button></div>
      <div class="sheet-body">${html}</div></div>`;
  wrap._onClose = onClose;
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) closeSheet(); });
  document.body.append(wrap);
  return $(".sheet-body", wrap);
}

function closeSheet() {
  const el = $(".sheet-backdrop");
  if (!el) return;
  el._onClose?.();
  el.remove();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// ---------------------------------------------------------------- router

async function route() {
  closeSheet();
  const page = (location.hash.replace(/^#\/?/, "") || "home").split("?")[0];
  if (!state.token) return page === "signup" ? renderSignup() : renderLogin();
  try {
    if (!state.me) await loadMe();
    if (!state.profile) return renderOnboarding();
    const pages = { home: renderHome, workouts: renderWorkouts, food: renderFood, progress: renderProgress, profile: renderProfile, qr: renderQrStickers };
    await (pages[page] || renderHome)();
  } catch (err) {
    if (err.status !== 401) {
      $("#app").innerHTML = `<main class="auth"><h1>Something went wrong</h1><p class="error">${esc(err.message)}</p><button class="btn" onclick="location.reload()">Reload</button></main>`;
    }
  }
}

window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- auth

const LOGO = `<div class="logo">${svgIcon("workouts").replace('stroke-width="1.8"', 'stroke-width="2.4"')}</div>`;

function renderLogin() {
  destroyCharts();
  $("#app").innerHTML = `
    <main class="auth">
      ${LOGO}
      <h1>Welcome back</h1>
      <p class="muted">Log in to see your plan, workouts and food log.</p>
      <form id="login">
        <label for="email">Email</label>
        <input id="email" name="username" type="email" autocomplete="email" required>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <p class="error hidden" id="err"></p>
        <button class="btn block mt">Log in</button>
      </form>
      <p class="center mt">New here? <a href="#/signup" class="link">Create an account</a></p>
    </main>`;
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await doLogin(f.get("username"), f.get("password"));
    } catch (err) { showError("#err", err.message); }
  });
}

async function doLogin(email, password) {
  const res = await api("/auth/login", { method: "POST", form: { username: email, password } });
  state.token = res.access_token;
  store.set("token", state.token);
  state.me = null;
  go("#/home");
}

function renderSignup() {
  destroyCharts();
  $("#app").innerHTML = `
    <main class="auth">
      ${LOGO}
      <h1>Create your account</h1>
      <p class="muted">Get your BMI, daily calories and a workout plan in a minute.</p>
      <form id="signup">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
        <label for="password">Password <span class="muted">(at least 8 characters)</span></label>
        <input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <label class="check mt"><input type="checkbox" name="marketing"> <span>Email me ads and discounts. You can unsubscribe at any time.</span></label>
        <p class="error hidden" id="err"></p>
        <button class="btn block mt">Sign up</button>
      </form>
      <p class="center mt">Already have an account? <a href="#/login" class="link">Log in</a></p>
    </main>`;
  $("#signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/auth/signup", { method: "POST", body: { email: f.get("email"), password: f.get("password"), marketing_opt_in: f.get("marketing") === "on" } });
      await doLogin(f.get("email"), f.get("password"));
    } catch (err) { showError("#err", err.message); }
  });
}

function showError(sel, msg) {
  const el = $(sel);
  el.textContent = msg;
  el.classList.remove("hidden");
}

// ---------------------------------------------------------------- profile form (onboarding + profile tab)

const ACTIVITY = {
  sedentary: "Sedentary – desk job, little exercise",
  light: "Light – exercise 1–3 days a week",
  moderate: "Moderate – exercise 3–5 days a week",
  active: "Active – hard exercise 6–7 days a week",
  very_active: "Very active – physical job + training",
};
const GOALS = { auto: "Decide from my BMI", lose: "Lose weight", maintain: "Maintain weight", gain: "Gain weight" };
const EQUIPMENT = { gym: "Gym (machines + free weights)", home: "Home (dumbbells)", bodyweight: "Bodyweight only" };

function options(map, selected) {
  return Object.entries(map).map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${esc(l)}</option>`).join("");
}

function profileFormHTML(p) {
  const imp = p?.unit_system === "imperial";
  const height = p ? (imp ? round(p.height_cm / CM_PER_IN, 1) : round(p.height_cm, 1)) : "";
  const weight = p ? (imp ? round(p.weight_kg / KG_PER_LB, 1) : round(p.weight_kg, 1)) : "";
  return `
  <form id="profile-form">
    <div class="card">
      <h3>About you</h3>
      <label>Units</label>
      <div class="seg" id="unit-seg">
        <button type="button" data-u="metric" class="${imp ? "" : "on"}">kg · cm</button>
        <button type="button" data-u="imperial" class="${imp ? "on" : ""}">lb · in</button>
      </div>
      <div class="grid2">
        <div><label for="birth_date">Birth date</label><input id="birth_date" name="birth_date" type="date" required value="${p?.birth_date ?? ""}" max="${todayISO()}"></div>
        <div><label for="sex">Sex</label><select id="sex" name="sex">${options({ male: "Male", female: "Female" }, p?.sex)}</select></div>
      </div>
      <div class="grid2">
        <div><label for="height">Height (<span data-lu>${imp ? "in" : "cm"}</span>)</label><input id="height" name="height" type="number" step="0.1" min="1" required value="${height}"></div>
        <div><label for="weight">Weight (<span data-wu>${imp ? "lb" : "kg"}</span>)</label><input id="weight" name="weight" type="number" step="0.1" min="1" required value="${weight}"></div>
      </div>
      <label for="activity_level">Activity level</label>
      <select id="activity_level" name="activity_level">${options(ACTIVITY, p?.activity_level ?? "moderate")}</select>
    </div>
    <div class="card">
      <h3>Your goal</h3>
      <label for="goal">Goal</label>
      <select id="goal" name="goal">${options(GOALS, p?.goal ?? "auto")}</select>
      <label for="diet_option">Diet</label>
      <select id="diet_option" name="diet_option">${options({ light: "Light – small change, easy to keep", normal: "Normal – steady progress", extreme: "Extreme – fastest, hardest" }, p?.diet_option ?? "normal")}</select>
    </div>
    <div class="card">
      <h3>Training availability</h3>
      <div class="grid2">
        <div><label for="days_per_week">Days per week</label><select id="days_per_week" name="days_per_week">${[1, 2, 3, 4, 5, 6].map((d) => `<option ${d === (p?.days_per_week ?? 3) ? "selected" : ""}>${d}</option>`).join("")}</select></div>
        <div><label for="minutes_per_session">Minutes per session</label><select id="minutes_per_session" name="minutes_per_session">${[20, 30, 45, 60, 75, 90].map((m) => `<option ${m === (p?.minutes_per_session ?? 45) ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      </div>
      <label for="equipment">Equipment</label>
      <select id="equipment" name="equipment">${options(EQUIPMENT, p?.equipment ?? "gym")}</select>
    </div>
    <p class="error hidden" id="profile-err"></p>
    <button class="btn block">${p ? "Save changes" : "See my plan"}</button>
  </form>`;
}

function bindProfileForm(onSaved) {
  const form = $("#profile-form");
  let unitSystem = $("#unit-seg .on").dataset.u;
  $("#unit-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.dataset.u === unitSystem) return;
    unitSystem = b.dataset.u;
    $$("#unit-seg button").forEach((x) => x.classList.toggle("on", x === b));
    const imp = unitSystem === "imperial";
    const h = parseFloat(form.height.value), w = parseFloat(form.weight.value);
    if (h) form.height.value = round(imp ? h / CM_PER_IN : h * CM_PER_IN, 1);
    if (w) form.weight.value = round(imp ? w / KG_PER_LB : w * KG_PER_LB, 1);
    $("[data-lu]").textContent = imp ? "in" : "cm";
    $("[data-wu]").textContent = imp ? "lb" : "kg";
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const imp = unitSystem === "imperial";
    const body = {
      birth_date: f.get("birth_date"),
      sex: f.get("sex"),
      height: parseFloat(f.get("height")),
      height_unit: imp ? "in" : "cm",
      weight: parseFloat(f.get("weight")),
      weight_unit: imp ? "lb" : "kg",
      activity_level: f.get("activity_level"),
      goal: f.get("goal"),
      diet_option: f.get("diet_option"),
      days_per_week: Number(f.get("days_per_week")),
      minutes_per_session: Number(f.get("minutes_per_session")),
      equipment: f.get("equipment"),
      unit_system: unitSystem,
    };
    try {
      await api("/me/profile", { method: "PUT", body });
      await refreshPlan();
      state.me.has_profile = true;
      onSaved();
    } catch (err) { showError("#profile-err", err.message); }
  });
}

/** Profile payload from the saved profile, for small changes like switching the diet option. */
function profilePayload(changes = {}) {
  const p = state.profile;
  return {
    birth_date: p.birth_date, sex: p.sex, height: p.height_cm, height_unit: "cm", weight: p.weight_kg, weight_unit: "kg",
    activity_level: p.activity_level, goal: p.goal, diet_option: p.diet_option, days_per_week: p.days_per_week,
    minutes_per_session: p.minutes_per_session, equipment: p.equipment, unit_system: p.unit_system, ...changes,
  };
}

function renderOnboarding() {
  destroyCharts();
  $("#app").innerHTML = `
    <header class="top"><div><h1>Set up your profile</h1><div class="sub">This gives you your BMI, calories and workout plan</div></div>
    <button class="btn ghost small" id="logout">Log out</button></header>
    <main>${profileFormHTML(null)}</main>`;
  $("#logout").onclick = logout;
  bindProfileForm(() => go("#/home"));
}

// ---------------------------------------------------------------- home

const BMI_ZONES = [
  { label: "Under", from: 15, to: 18.5, color: "var(--series-1)" },
  { label: "Normal", from: 18.5, to: 25, color: "var(--good)" },
  { label: "Over", from: 25, to: 30, color: "var(--warn)" },
  { label: "Obese", from: 30, to: 40, color: "var(--critical)" },
];
const BMI_BADGE = { underweight: "info", normal: "good", overweight: "warn", obese: "bad" };

async function renderHome() {
  const plan = state.plan;
  const day = await api(`/food-logs?date=${todayISO()}`);
  const eaten = day.totals.calories;
  const target = plan.target_calories;
  const pct = Math.min(100, (eaten / target) * 100);
  const marker = ((Math.min(Math.max(plan.bmi, 15), 40) - 15) / 25) * 100;
  const change = plan.weight_change_kg;
  const goalText = plan.direction === "maintain"
    ? "You are in the healthy range. Your plan keeps your weight steady."
    : `${change < 0 ? "Lose" : "Gain"} <b>${fmtW(Math.abs(change))}</b> to reach the optimal BMI of 22 (<b>${fmtW(plan.optimal_weight_kg)}</b>).`;
  const rangeText = plan.change_to_healthy_range_kg !== 0
    ? `<div class="small text-2 mt-s">Smallest step into the healthy range: ${fmtWDelta(plan.change_to_healthy_range_kg)}</div>` : "";

  shell("home", `Hi there`, esc(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })), `
    <div class="card">
      <div class="card-head"><h3>Body mass index</h3><span class="badge ${BMI_BADGE[plan.bmi_category]}">${cap(plan.bmi_category)}</span></div>
      <div class="row between" style="align-items:flex-end">
        <div class="hero num">${fmt(plan.bmi, 1)}</div>
        <div class="small text-2" style="text-align:right">${fmtW(plan.weight_kg)} · ${fmt(fromCm(plan.height_cm), imperial() ? 1 : 0)} ${lUnit()}<br>Age ${plan.age}</div>
      </div>
      <div class="scale-wrap">
        <div class="scale">${BMI_ZONES.map((z) => `<span style="flex:${z.to - z.from};background:${z.color}"></span>`).join("")}</div>
        <div class="scale-marker" style="left:${marker}%" title="Your BMI"></div>
      </div>
      <div class="scale-labels">${[15, 18.5, 25, 30, 40].map((v) => `<span style="left:${((v - 15) / 25) * 100}%">${v}</span>`).join("")}</div>
      <p class="mt" style="margin-bottom:0">${goalText}</p>
      <div class="small text-2 mt-s">Healthy weight for your height: ${fmtW(plan.healthy_weight_min_kg)} – ${fmtW(plan.healthy_weight_max_kg)}</div>
      ${rangeText}
    </div>

    <div class="card">
      <div class="card-head"><h3>Today's calories</h3><a href="#/food" class="link small">Food log ›</a></div>
      <div class="row between"><div><span class="big num">${fmt(eaten)}</span> <span class="muted">/ ${fmt(target)} kcal</span></div>
        <span class="small text-2">${eaten <= target ? `${fmt(target - eaten)} left` : `${fmt(eaten - target)} over`}</span></div>
      <div class="meter ${eaten > target ? "over" : ""}" role="progressbar" aria-valuenow="${round(eaten)}" aria-valuemax="${target}"><span style="width:${pct}%"></span></div>
      ${macroBars(day.totals, target)}
    </div>

    <h2>Daily calories</h2>
    <div class="card">
      <div class="stats">
        <div class="stat"><div class="label">Resting (BMR)</div><div class="value">${fmt(plan.bmr)}</div></div>
        <div class="stat"><div class="label">Maintenance</div><div class="value">${fmt(plan.tdee)}</div></div>
        <div class="stat"><div class="label">Your target</div><div class="value">${fmt(plan.target_calories)}</div></div>
      </div>
      <p class="small text-2 mt">${plan.direction === "maintain" ? "Eat about your maintenance calories to keep your weight." : `Pick how fast you want to ${plan.direction} weight. Eating exactly this many calories a day:`}</p>
      <div class="options" id="diet-options">
        ${plan.options.map((o) => dietOptionHTML(o, plan.direction)).join("")}
      </div>
      <p class="tiny muted mt">${esc(plan.disclaimer)} 1 kg of body fat ≈ 7,700 kcal.</p>
    </div>

    <h2>Log your weight</h2>
    <form class="card row" id="weigh-in">
      <div class="grow"><label for="w" class="hidden">Weight</label><input id="w" name="weight" type="number" step="0.1" min="1" placeholder="Today's weight (${wUnit()})" required></div>
      <button class="btn">Save</button>
    </form>
  `);

  $("#diet-options").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-option]");
    if (!b || b.classList.contains("selected") || b.dataset.option === "maintain") return;
    await api("/me/profile", { method: "PUT", body: profilePayload({ diet_option: b.dataset.option }) });
    await refreshPlan();
    toast(`Switched to the ${b.dataset.option} diet`);
    renderHome();
  });
  $("#weigh-in").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = parseFloat(e.target.weight.value);
    await api("/me/weight", { method: "POST", body: { weight: v, unit: wUnit() } });
    await refreshPlan();
    toast("Weight saved");
    renderHome();
  });
}

function dietOptionHTML(o, direction) {
  if (o.option === "maintain") {
    return `<div class="option selected" data-option="maintain"><span class="name">Maintain</span><span class="kcal">${fmt(o.calories)} kcal</span>
      <span class="detail">Same as your maintenance calories</span></div>`;
  }
  const sign = o.difference > 0 ? "+" : "−";
  const weeks = o.weeks_to_target != null ? ` · goal in ~${fmt(o.weeks_to_target)} weeks` : "";
  return `<button type="button" class="option ${o.selected ? "selected" : ""}" data-option="${o.option}" aria-pressed="${o.selected}">
    <span class="name">${o.option}${o.selected ? ' <span class="badge info">Current</span>' : ""}</span>
    <span class="kcal">${fmt(o.calories)} kcal</span>
    <span class="detail">${sign}${fmt(Math.abs(o.difference))} kcal/day · ${direction === "lose" ? "lose" : "gain"} ~${fmtW(Math.abs(o.weekly_change_kg), 2)}/week${weeks}</span>
    ${o.warning ? `<span class="warning">⚠ ${esc(o.warning)}</span>` : ""}
  </button>`;
}

function macroBars(t, targetKcal) {
  // Rough macro targets: 30% protein, 40% carbs, 30% fat of the calorie target
  const goals = { protein_g: (targetKcal * 0.3) / 4, carbs_g: (targetKcal * 0.4) / 4, fat_g: (targetKcal * 0.3) / 9 };
  const rows = [["Protein", "protein_g", "var(--series-1)"], ["Carbs", "carbs_g", "var(--series-2)"], ["Fat", "fat_g", "var(--series-3)"]];
  return `<div class="macros">${rows.map(([label, key, color]) => `
    <div class="macro"><div class="small text-2">${label}</div><div class="num"><b>${fmt(t[key])}</b> <span class="muted small">/ ${fmt(goals[key])} g</span></div>
    <div class="bar"><span style="width:${Math.min(100, (t[key] / goals[key]) * 100)}%;background:${color}"></span></div></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- workouts

async function renderWorkouts() {
  const [workouts, routine] = await Promise.all([api("/workouts?limit=15"), api("/me/routine")]);
  const active = workouts.find((w) => !w.ended_at);
  const activeFull = active ? await api(`/workouts/${active.id}`) : null;
  const history = workouts.filter((w) => w.ended_at);

  shell("workouts", "Workouts", `${esc(routine.split)} · ${routine.days_per_week} days a week`, `
    ${activeFull ? activeWorkoutHTML(activeFull) : `
      <div class="card center">
        <p class="text-2" style="margin-top:0">Ready to train? Start a workout and add exercises by name or by scanning the machine's QR code.</p>
        <button class="btn block" id="start">Start workout</button>
      </div>`}

    <h2>Your routine</h2>
    <div class="card">
      <div class="small text-2">${routine.exercises_per_day} exercises per session · ${routine.minutes_per_session} min</div>
      ${routine.days.map((d, i) => `
        <details class="day" ${i === 0 ? "open" : ""}>
          <summary><span><b>${esc(d.weekday)}</b> · ${esc(d.title)}</span></summary>
          <ol>${d.exercises.map((x) => `<li><button class="link" data-routine-ex="${x.exercise_id}" data-name="${esc(x.name)}">${esc(x.name)}</button>
            <span class="muted small"> · ${x.sets} × ${esc(x.reps)}</span></li>`).join("")}
            ${d.cardio_minutes ? `<li class="muted">${d.cardio_minutes} min cardio</li>` : ""}</ol>
        </details>`).join("")}
      <ul class="small text-2" style="margin:8px 0 0;padding-left:18px">${routine.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>

    <h2>History</h2>
    <div class="card">
      ${history.length ? `<ul class="list">${history.map((w) => `
        <li><button class="item" data-history="${w.id}">
          <div class="grow"><div class="title">${esc(longDate(w.started_at))}</div>
          <div class="small muted">${w.set_count} sets · ${fmtW(w.volume_kg, 0)} volume${w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}</div></div>
          <span class="muted">›</span></button></li>`).join("")}</ul>` : `<p class="muted center" style="margin:0">No finished workouts yet.</p>`}
    </div>
    <p class="center"><a href="#/qr" class="link small">Print QR stickers for the machines</a></p>
  `);

  $("#start")?.addEventListener("click", async () => {
    await api("/workouts", { method: "POST", body: {} });
    renderWorkouts();
  });
  $("main").addEventListener("click", async (e) => {
    const r = e.target.closest("[data-routine-ex]");
    if (r) {
      e.preventDefault();
      if (!activeFull) return toast("Start a workout first, then tap an exercise to log it");
      return openSetForm(activeFull.id, { id: Number(r.dataset.routineEx), name: r.dataset.name }, "name");
    }
    const h = e.target.closest("[data-history]");
    if (h) return openHistory(Number(h.dataset.history));
  });
  if (activeFull) bindActiveWorkout(activeFull);
}

function duration(a, b) {
  const min = Math.round((new Date(b) - new Date(a)) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function groupSets(sets) {
  const groups = new Map();
  for (const s of sets) {
    if (!groups.has(s.exercise_id)) groups.set(s.exercise_id, { name: s.exercise_name, id: s.exercise_id, sets: [] });
    groups.get(s.exercise_id).sets.push(s);
  }
  return [...groups.values()];
}

function setsListHTML(sets, editable) {
  const groups = groupSets(sets);
  if (!groups.length) return `<p class="muted small" style="margin:0">No sets yet.</p>`;
  return groups.map((g) => `
    <div class="mt-s">
      <div class="row between"><b>${esc(g.name)}</b>${editable ? `<button class="btn soft small" data-more="${g.id}" data-name="${esc(g.name)}">+ Set</button>` : ""}</div>
      <ul class="list small">${g.sets.map((s) => `<li>
        <span class="muted num" style="width:18px">${s.set_number}</span>
        <span class="grow num">${s.reps} reps × ${fmtW(s.weight_kg)}${s.rpe ? ` · RPE ${s.rpe}` : ""}${s.notes ? ` · <span class="muted">${esc(s.notes)}</span>` : ""}</span>
        ${s.added_via === "qr" ? '<span class="source">QR</span>' : ""}
        ${editable ? `<button class="btn ghost icon small" data-del-set="${s.id}" aria-label="Delete set">✕</button>` : ""}</li>`).join("")}</ul>
    </div>`).join("");
}

function activeWorkoutHTML(w) {
  return `
    <div class="card" id="active">
      <div class="card-head"><h3>Workout in progress</h3><span class="badge info">Started ${new Date(w.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div class="small text-2">${w.set_count} sets · ${fmtW(w.volume_kg, 0)} volume</div>
      <div class="row mt">
        <button class="btn grow" id="add-name">Type exercise</button>
        <button class="btn soft grow" id="add-qr">Scan QR code</button>
      </div>
      <div class="mt">${setsListHTML(w.sets, true)}</div>
      <label for="w-notes">Notes</label>
      <textarea id="w-notes" rows="2" placeholder="How did it go?">${esc(w.notes)}</textarea>
      <div class="row mt">
        <button class="btn danger" id="discard">Discard</button>
        <button class="btn grow" id="finish">Finish workout</button>
      </div>
    </div>`;
}

function bindActiveWorkout(w) {
  $("#add-name").onclick = () => openExerciseSearch(w.id);
  $("#add-qr").onclick = () => openQrScanner(w.id);
  $("#finish").onclick = async () => {
    await api(`/workouts/${w.id}`, { method: "PATCH", body: { finish: true, notes: $("#w-notes").value } });
    toast("Workout saved. Nice work!");
    renderWorkouts();
  };
  $("#discard").onclick = async () => {
    if (!confirm("Delete this workout and all its sets?")) return;
    await api(`/workouts/${w.id}`, { method: "DELETE" });
    renderWorkouts();
  };
  $("#active").addEventListener("click", async (e) => {
    const more = e.target.closest("[data-more]");
    if (more) return openSetForm(w.id, { id: Number(more.dataset.more), name: more.dataset.name }, "name");
    const del = e.target.closest("[data-del-set]");
    if (del) {
      await api(`/workouts/${w.id}/sets/${del.dataset.delSet}`, { method: "DELETE" });
      renderWorkouts();
    }
  });
}

function exerciseResultsHTML(list) {
  if (!list.length) return `<p class="muted small">No match. Try another name, e.g. "chest press".</p>`;
  return `<ul class="list">${list.map((x) => `<li><button class="item" data-pick="${x.id}" data-name="${esc(x.name)}">
    <div class="grow"><div class="title">${esc(x.name)}</div><div class="small muted">${esc(cap(x.muscle_group))} · ${esc(x.category)}</div></div>
    <span class="muted">›</span></button></li>`).join("")}</ul>`;
}

function openExerciseSearch(workoutId) {
  const body = openSheet("Add exercise", `
    <label for="ex-q">Machine or exercise name</label>
    <input id="ex-q" placeholder="e.g. lat pulldown" autocomplete="off">
    <div id="ex-results" class="mt"></div>`);
  const input = $("#ex-q", body);
  const search = debounce(async () => {
    const list = await api(`/exercises?limit=8&search=${encodeURIComponent(input.value)}`);
    $("#ex-results", body).innerHTML = exerciseResultsHTML(list);
  }, 200);
  input.addEventListener("input", search);
  search();
  input.focus();
  body.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pick]");
    if (p) openSetForm(workoutId, { id: Number(p.dataset.pick), name: p.dataset.name }, "name");
  });
}

function openQrScanner(workoutId) {
  let scanner = null;
  const stop = () => { if (scanner?.isScanning) scanner.stop().catch(() => {}); };
  const body = openSheet("Scan machine QR code", `
    <div id="qr-reader"></div>
    <p class="small text-2 mt" id="qr-status">Point the camera at the sticker on the machine.</p>
    <form class="row" id="qr-manual">
      <input name="code" placeholder="…or type the code, e.g. leg-press" autocomplete="off">
      <button class="btn">Find</button>
    </form>
    <p class="error hidden" id="qr-err"></p>`, stop);

  const lookup = async (text) => {
    try {
      const ex = await api(`/exercises/qr/${encodeURIComponent(text.trim())}`);
      stop();
      openSetForm(workoutId, ex, "qr");
    } catch (err) { showError("#qr-err", err.message); }
  };
  $("#qr-manual", body).addEventListener("submit", (e) => { e.preventDefault(); if (e.target.code.value.trim()) lookup(e.target.code.value); });

  if (window.Html5Qrcode) {
    scanner = new Html5Qrcode("qr-reader", { verbose: false });
    scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 220, height: 220 } }, (text) => lookup(text), () => {})
      .catch(() => {
        $("#qr-reader").classList.add("hidden");
        $("#qr-status").textContent = "No camera found (or camera permission denied). Type the code printed under the QR sticker instead.";
      });
  }
}

async function openSetForm(workoutId, exercise, addedVia) {
  const w = await api(`/workouts/${workoutId}`);
  const previous = w.sets.filter((s) => s.exercise_id === exercise.id);
  const last = previous[previous.length - 1];
  const unit = wUnit();
  const body = openSheet(exercise.name, `
    ${previous.length ? `<div class="small text-2">This workout</div>${setsListHTML(previous, false)}` : `<p class="small text-2" style="margin-top:0">${addedVia === "qr" ? "Found by QR code. " : ""}Log your first set.</p>`}
    <form id="set-form">
      <div class="grid2">
        <div><label for="reps">Reps</label><input id="reps" name="reps" type="number" min="0" step="1" required value="${last?.reps ?? 10}"></div>
        <div><label for="weight">Weight</label><div class="input-unit"><input id="weight" name="weight" type="number" min="0" step="0.5" value="${last ? round(fromKg(last.weight_kg), 1) : ""}" placeholder="0">
          <select name="unit" aria-label="Weight unit"><option ${unit === "kg" ? "selected" : ""}>kg</option><option ${unit === "lb" ? "selected" : ""}>lb</option></select></div></div>
      </div>
      <div class="grid2">
        <div><label for="rpe">RPE <span class="muted">(1–10, optional)</span></label><input id="rpe" name="rpe" type="number" min="1" max="10" step="0.5" value="${last?.rpe ?? ""}"></div>
        <div><label for="rest">Rest (sec, optional)</label><input id="rest" name="rest" type="number" min="0" step="5" value="${last?.rest_seconds ?? ""}"></div>
      </div>
      <label for="notes">Notes</label>
      <input id="notes" name="notes" placeholder="e.g. seat at 4, felt easy">
      <p class="error hidden" id="set-err"></p>
      <button class="btn block mt">Add set ${previous.length + 1}</button>
    </form>`, () => { if (location.hash.startsWith("#/workouts")) renderWorkouts(); });
  $("#set-form", body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/workouts/${workoutId}/sets`, { method: "POST", body: {
        exercise_id: exercise.id, reps: Number(f.reps.value), weight: parseFloat(f.weight.value) || 0, unit: f.unit.value,
        rpe: f.rpe.value ? parseFloat(f.rpe.value) : null, rest_seconds: f.rest.value ? Number(f.rest.value) : null,
        notes: f.notes.value, added_via: addedVia,
      } });
      toast(`Set saved: ${f.reps.value} × ${f.weight.value || 0} ${f.unit.value}`);
      openSetForm(workoutId, exercise, addedVia);
    } catch (err) { showError("#set-err", err.message); }
  });
}

async function openHistory(id) {
  const w = await api(`/workouts/${id}`);
  const body = openSheet(longDate(w.started_at), `
    <div class="small text-2">${w.set_count} sets · ${fmtW(w.volume_kg, 0)} volume${w.ended_at ? ` · ${duration(w.started_at, w.ended_at)}` : ""}</div>
    ${w.notes ? `<p>${esc(w.notes)}</p>` : ""}
    ${setsListHTML(w.sets, false)}
    <button class="btn danger block mt" id="del-w">Delete workout</button>`);
  $("#del-w", body).onclick = async () => {
    if (!confirm("Delete this workout?")) return;
    await api(`/workouts/${id}`, { method: "DELETE" });
    closeSheet();
    renderWorkouts();
  };
}

async function renderQrStickers() {
  const list = await api("/exercises?limit=100");
  shell("workouts", "QR stickers", "Print and stick one on each machine",
    `<p class="small text-2 no-print">Scanning a sticker in the app opens that machine straight away. The text under each code can also be typed in.</p>
     <button class="btn block no-print" onclick="window.print()">Print</button>
     <div class="qr-grid mt">${list.map((x) => `<figure><img src="/api/exercises/${x.id}/qr.png" alt="QR code for ${esc(x.name)}" loading="lazy">
       <figcaption>${esc(x.name)}<br><span style="font-weight:400">${esc(x.qr_code)}</span></figcaption></figure>`).join("")}</div>`,
    `<a href="#/workouts" class="btn ghost small">Back</a>`);
}

// ---------------------------------------------------------------- food

const MEALS = ["breakfast", "lunch", "dinner", "snack"];
let foodDate = todayISO();

async function renderFood() {
  const day = await api(`/food-logs?date=${foodDate}`);
  const target = day.target_calories;
  const eaten = day.totals.calories;
  const isToday = foodDate === todayISO();
  shell("food", "Food log", isToday ? "Today" : esc(longDate(foodDate)), `
    <div class="card">
      <div class="row between">
        <button class="btn ghost icon" id="prev-day" aria-label="Previous day">‹</button>
        <b>${isToday ? "Today" : esc(longDate(foodDate))}</b>
        <button class="btn ghost icon" id="next-day" aria-label="Next day" ${isToday ? "disabled" : ""}>›</button>
      </div>
      <div class="row between mt"><div><span class="big num">${fmt(eaten)}</span> <span class="muted">/ ${fmt(target)} kcal</span></div>
        <span class="small text-2">${eaten <= target ? `${fmt(target - eaten)} left` : `${fmt(eaten - target)} over`}</span></div>
      <div class="meter ${eaten > target ? "over" : ""}"><span style="width:${Math.min(100, (eaten / target) * 100)}%"></span></div>
      ${macroBars(day.totals, target)}
    </div>
    ${MEALS.map((meal) => {
      const items = day.entries.filter((e) => e.meal === meal);
      const kcal = items.reduce((a, b) => a + b.calories, 0);
      return `<div class="card">
        <div class="meal-head"><h3>${cap(meal)} ${items.length ? `<span class="muted small">· ${fmt(kcal)} kcal</span>` : ""}</h3>
          <button class="btn soft small" data-add="${meal}">+ Add</button></div>
        ${items.length ? `<ul class="list">${items.map((e) => `<li>
          <div class="grow"><div class="title">${esc(e.food_name)}</div>
          <div class="small muted">${fmt(e.quantity, 2)} ${esc(unitLabel(e.unit))} · P ${fmt(e.protein_g)} · C ${fmt(e.carbs_g)} · F ${fmt(e.fat_g)} g</div></div>
          <span class="kcal">${fmt(e.calories)}</span>
          <button class="btn ghost icon small" data-del-log="${e.id}" aria-label="Remove ${esc(e.food_name)}">✕</button></li>`).join("")}</ul>` : ""}
      </div>`;
    }).join("")}
    <button class="btn ghost block" id="custom">Create a custom food</button>
  `);
  $("#prev-day").onclick = () => { const d = parseISO(foodDate); d.setDate(d.getDate() - 1); foodDate = isoDate(d); renderFood(); };
  $("#next-day").onclick = () => { const d = parseISO(foodDate); d.setDate(d.getDate() + 1); foodDate = isoDate(d); renderFood(); };
  $("#custom").onclick = () => openCustomFood("snack");
  $("main").addEventListener("click", async (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return openFoodSearch(add.dataset.add);
    const del = e.target.closest("[data-del-log]");
    if (del) { await api(`/food-logs/${del.dataset.delLog}`, { method: "DELETE" }); renderFood(); }
  });
}

function foodRowHTML(f, key) {
  const per = f.is_liquid ? "100 ml" : "100 g";
  const src = { usda: "USDA", off: "Open Food Facts", manual: "Mine", builtin: "" }[f.source];
  return `<li><button class="item" data-food="${key}">
    <div class="grow"><div class="title">${esc(f.name)}</div>
      <div class="small muted">${f.brand ? `${esc(f.brand)} · ` : ""}${fmt(f.calories)} kcal per ${per}</div></div>
    ${src ? `<span class="source">${src}</span>` : ""}<span class="muted">›</span></button></li>`;
}

function openFoodSearch(meal) {
  let found = { local: [], online: [] };
  const body = openSheet(`Add to ${meal}`, `
    <label for="food-q">Search food</label>
    <input id="food-q" placeholder="e.g. banana, chicken breast, nutella" autocomplete="off">
    <div id="food-local" class="mt"></div>
    <div id="food-online"></div>
    <button class="btn ghost block mt" id="custom2">Not found? Create a custom food</button>`);
  const input = $("#food-q", body);

  const runSearch = debounce(async () => {
    const q = input.value.trim();
    if (!q) { $("#food-local", body).innerHTML = ""; $("#food-online", body).innerHTML = ""; return; }
    const local = await api(`/foods/search?online=false&q=${encodeURIComponent(q)}`);
    if (q !== input.value.trim()) return;
    found = { local: local.local, online: [] };
    $("#food-local", body).innerHTML = local.local.length
      ? `<div class="small text-2">In the app</div><ul class="list">${local.local.map((f, i) => foodRowHTML(f, `l${i}`)).join("")}</ul>` : "";
    $("#food-online", body).innerHTML = `<p class="small muted">Searching USDA and Open Food Facts…</p>`;
    const all = await api(`/foods/search?online=true&q=${encodeURIComponent(q)}`);
    if (q !== input.value.trim()) return;
    found.online = all.online;
    $("#food-online", body).innerHTML = `
      ${all.online.length ? `<div class="small text-2 mt">Online databases</div><ul class="list">${all.online.map((f, i) => foodRowHTML(f, `o${i}`)).join("")}</ul>` : ""}
      ${all.warnings.map((w) => `<p class="small muted">${esc(w)}</p>`).join("")}
      ${!all.online.length && !local.local.length && !all.warnings.length ? `<p class="muted small">Nothing found.</p>` : ""}`;
  }, 300);

  input.addEventListener("input", runSearch);
  input.focus();
  $("#custom2", body).onclick = () => openCustomFood(meal);
  body.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-food]");
    if (!pick) return;
    const key = pick.dataset.food;
    let food = key[0] === "l" ? found.local[Number(key.slice(1))] : found.online[Number(key.slice(1))];
    if (key[0] === "o") food = await api("/foods/import", { method: "POST", body: food });
    openFoodDetail(food, meal);
  });
}

const SUB_NUTRIENTS = [
  ["fiber_g", "Fiber", "g"], ["sugar_g", "Sugars", "g"], ["added_sugar_g", "Added sugars", "g"], ["saturated_fat_g", "Saturated fat", "g"],
  ["trans_fat_g", "Trans fat", "g"], ["cholesterol_mg", "Cholesterol", "mg"], ["sodium_mg", "Sodium", "mg"], ["potassium_mg", "Potassium", "mg"],
];

async function openFoodDetail(food, meal) {
  const units = await api(`/foods/${food.id}/units`);
  const per = food.is_liquid ? "100 ml" : "100 g";
  const subs = SUB_NUTRIENTS.filter(([k]) => food[k] != null);
  const body = openSheet(food.name, `
    <div class="small text-2">${food.brand ? `${esc(food.brand)} · ` : ""}${food.is_liquid ? "Liquid" : "Solid"}${food.serving_size ? ` · 1 serving = ${fmt(food.serving_size, 1)} ${esc(unitLabel(food.serving_unit))}` : ""}</div>
    <form id="log-form">
      <div class="grid2">
        <div><label for="qty">Amount</label><input id="qty" name="qty" type="number" min="0" step="any" required value="${units[0] === "serving" ? 1 : food.is_liquid ? 250 : 100}"></div>
        <div><label for="unit">Unit</label><select id="unit" name="unit">${units.map((u) => `<option value="${u}">${esc(unitLabel(u))}</option>`).join("")}</select></div>
      </div>
      <label for="meal">Meal</label>
      <select id="meal" name="meal">${MEALS.map((m) => `<option value="${m}" ${m === meal ? "selected" : ""}>${cap(m)}</option>`).join("")}</select>
      <div class="stats mt" id="preview" style="grid-template-columns:repeat(4,1fr)"></div>
      <p class="error hidden" id="log-err"></p>
      <button class="btn block mt">Add to log</button>
    </form>
    <h3 class="mt">Per ${per}</h3>
    <table class="data"><tbody>
      <tr><td>Calories</td><td>${fmt(food.calories)} kcal</td></tr>
      <tr><td>Protein</td><td>${fmt(food.protein_g, 1)} g</td></tr>
      <tr><td>Carbohydrates</td><td>${fmt(food.carbs_g, 1)} g</td></tr>
      <tr><td>Fat</td><td>${fmt(food.fat_g, 1)} g</td></tr>
      ${subs.map(([k, label, u]) => `<tr><td class="text-2">&nbsp;&nbsp;${label}</td><td>${fmt(food[k], 1)} ${u}</td></tr>`).join("")}
    </tbody></table>`);
  const form = $("#log-form", body);
  const preview = () => {
    const amount = baseAmount(food, parseFloat(form.qty.value) || 0, form.unit.value);
    const f = (amount ?? 0) / 100;
    $("#preview", body).innerHTML = [["kcal", food.calories], ["Protein g", food.protein_g], ["Carbs g", food.carbs_g], ["Fat g", food.fat_g]]
      .map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${fmt(v * f, l === "kcal" ? 0 : 1)}</div></div>`).join("");
  };
  form.addEventListener("input", preview);
  preview();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/food-logs", { method: "POST", body: { food_id: food.id, date: foodDate, meal: form.meal.value, quantity: parseFloat(form.qty.value), unit: form.unit.value } });
      closeSheet();
      toast(`${food.name} added`);
      if (location.hash.startsWith("#/food")) renderFood(); else go("#/food");
    } catch (err) { showError("#log-err", err.message); }
  });
}

function openCustomFood(meal) {
  const body = openSheet("Custom food", `
    <form id="custom-form">
      <label for="cf-name">Name</label><input id="cf-name" name="name" required placeholder="e.g. Mom's lentil soup">
      <label for="cf-brand">Brand <span class="muted">(optional)</span></label><input id="cf-brand" name="brand">
      <label class="check mt"><input type="checkbox" name="is_liquid" id="cf-liquid"> <span>It's a drink / liquid (measured in ml)</span></label>
      <div class="grid2">
        <div><label for="cf-size">Serving size</label><input id="cf-size" name="serving_size" type="number" min="0" step="any" required value="100"></div>
        <div><label for="cf-unit">Unit</label><select id="cf-unit" name="serving_unit"></select></div>
      </div>
      <label>Values are for</label>
      <div class="seg" id="cf-per"><button type="button" class="on" data-per="serving">1 serving</button><button type="button" data-per="100">100 g / ml</button></div>
      <div class="grid2">
        <div><label for="cf-kcal">Calories (kcal)</label><input id="cf-kcal" name="calories" type="number" min="0" step="any" required></div>
        <div><label for="cf-p">Protein (g)</label><input id="cf-p" name="protein_g" type="number" min="0" step="any" required></div>
        <div><label for="cf-c">Carbohydrates (g)</label><input id="cf-c" name="carbs_g" type="number" min="0" step="any" required></div>
        <div><label for="cf-f">Fat (g)</label><input id="cf-f" name="fat_g" type="number" min="0" step="any" required></div>
      </div>
      <details class="mt"><summary class="link">Sub-macros (optional)</summary>
        <div class="grid2">${SUB_NUTRIENTS.map(([k, label, u]) => `<div><label for="cf-${k}">${label} (${u})</label><input id="cf-${k}" name="${k}" type="number" min="0" step="any"></div>`).join("")}</div>
      </details>
      <p class="error hidden" id="cf-err"></p>
      <button class="btn block mt">Save and log it</button>
    </form>`);
  const form = $("#custom-form", body);
  let per = "serving";
  const fillUnits = () => {
    const list = Object.keys(form.is_liquid.checked ? VOLUME_TO_ML : MASS_TO_G);
    form.serving_unit.innerHTML = list.map((u) => `<option value="${u}">${unitLabel(u)}</option>`).join("");
  };
  fillUnits();
  form.is_liquid.addEventListener("change", fillUnits);
  $("#cf-per", body).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    per = b.dataset.per;
    $$("#cf-per button", body).forEach((x) => x.classList.toggle("on", x === b));
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const num = (n) => (form[n].value === "" ? null : parseFloat(form[n].value));
    const payload = {
      name: form.name.value, brand: form.brand.value, is_liquid: form.is_liquid.checked,
      serving_size: num("serving_size"), serving_unit: form.serving_unit.value, values_per: per,
      calories: num("calories"), protein_g: num("protein_g"), carbs_g: num("carbs_g"), fat_g: num("fat_g"),
    };
    for (const [k] of SUB_NUTRIENTS) payload[k] = num(k);
    try {
      const food = await api("/foods", { method: "POST", body: payload });
      openFoodDetail(food, meal);
    } catch (err) { showError("#cf-err", err.message); }
  });
}

// ---------------------------------------------------------------- charts

const charts = [];
function destroyCharts() { while (charts.length) charts.pop().destroy(); }
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES = () => [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--series-${i}`));

function baseOptions({ stacked = false, legend = true, yTitle = "" } = {}) {
  const text = cssVar("--text-2"), grid = cssVar("--grid");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legend, position: "top", align: "start", labels: { color: text, usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 12 } } },
      tooltip: {
        backgroundColor: cssVar("--surface"), titleColor: cssVar("--text-2"), bodyColor: cssVar("--text"),
        borderColor: cssVar("--border"), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        bodyFont: { weight: "600" }, titleFont: { weight: "400" },
      },
    },
    scales: {
      x: { stacked, grid: { display: false }, border: { color: grid }, ticks: { color: text, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } } },
      y: { stacked, grid: { color: grid, lineWidth: 1 }, border: { display: false }, ticks: { color: text, font: { size: 11 }, maxTicksLimit: 5 },
        title: { display: !!yTitle, text: yTitle, color: text, font: { size: 11 } } },
    },
  };
}

const lineDS = (label, data, color, extra = {}) => ({
  type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2,
  pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar("--surface"),
  pointStyle: "line", tension: 0.2, spanGaps: true, ...extra,
});
const refLineDS = (label, value, n) => lineDS(label, Array(n).fill(value), cssVar("--muted"), { borderWidth: 1.5, pointHoverRadius: 0, tension: 0 });
const barDS = (label, data, color, extra = {}) => ({
  type: "bar", label, data, backgroundColor: color, maxBarThickness: 24, borderRadius: 4, borderSkipped: "start", pointStyle: "rect", ...extra,
});

function chartCard(id, title, subtitle = "") {
  return `<div class="card">
    <div class="card-head"><h3>${title}</h3><button class="link small" data-table="${id}">Table</button></div>
    ${subtitle ? `<div class="small text-2" style="margin:-4px 0 8px">${subtitle}</div>` : ""}
    <div class="chart-box" id="${id}-box"><canvas id="${id}" role="img" aria-label="${esc(title)}"></canvas></div>
    <div class="hidden" id="${id}-table"></div>
  </div>`;
}

function drawChart(id, config, emptyText) {
  const box = $(`#${id}-box`);
  const hasData = config.data.datasets.some((d) => d.data.some((v) => v != null && v !== 0));
  if (!hasData) { box.outerHTML = `<div class="chart-empty" id="${id}-box">${esc(emptyText)}</div>`; return; }
  config.type ??= config.data.datasets[0].type;
  const chart = new Chart($(`#${id}`), config);
  charts.push(chart);
  // Table view: same numbers without the chart
  const ds = config.data.datasets;
  $(`#${id}-table`).innerHTML = `<table class="data"><thead><tr><th></th>${ds.map((d) => `<th>${esc(d.label)}</th>`).join("")}</tr></thead>
    <tbody>${config.data.labels.map((l, i) => `<tr><td>${esc(l)}</td>${ds.map((d) => `<td>${d.data[i] == null ? "–" : fmt(d.data[i], 1)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// ---------------------------------------------------------------- progress

async function renderProgress() {
  const [weight, projection, calories, volume, lifts, compare] = await Promise.all([
    api("/analytics/weight"), api("/me/plan/projection"), api("/analytics/calories"),
    api("/analytics/volume?weeks=8"), api("/analytics/exercises"), api("/measurements/compare"),
  ]);
  const wu = wUnit();

  shell("progress", "Progress", "Weight loss and strength over time", `
    ${chartCard("c-weight", `Body weight (${wu})`, "Each weigh-in, the 7-day average and your BMI 22 target")}
    ${chartCard("c-proj", `Projected weight (${wu})`, esc(projection.note))}
    ${chartCard("c-cal", "Calories, last 14 days", "Daily intake against your target")}
    ${chartCard("c-macro", "Macros, last 14 days (g)")}
    <div class="card">
      <div class="card-head"><h3>Lift progress (${wu})</h3><button class="link small" data-table="c-lift">Table</button></div>
      ${lifts.length ? `<select id="lift-pick" aria-label="Exercise">${lifts.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>` : ""}
      <div class="small text-2 mt-s">Estimated 1-rep max (Epley) and heaviest set per workout</div>
      <div class="chart-box mt-s" id="c-lift-box"><canvas id="c-lift" role="img" aria-label="Lift progress"></canvas></div>
      <div class="hidden" id="c-lift-table"></div>
    </div>
    ${chartCard("c-vol", "Weekly training volume", `Reps × weight (${wu}) per body region, last 8 weeks`)}

    <h2>Body measurements</h2>
    <div class="card" id="measure-card">${measurementsHTML(compare)}</div>
    <button class="btn ghost block" id="add-measure">Add measurements</button>
  `);

  // Body weight
  const n = weight.labels.length;
  const datasets = [
    lineDS("Weight", weight.series[0].data.map(fromKg), SERIES()[0], { pointRadius: n < 40 ? 3 : 0, pointStyle: "circle", pointBorderColor: cssVar("--surface"), pointBorderWidth: 1.5, tension: 0 }),
    lineDS("7-day average", weight.series[1].data.map(fromKg), SERIES()[1]),
  ];
  if (weight.target_weight_kg) datasets.push(refLineDS("Target", fromKg(weight.target_weight_kg), n));
  drawChart("c-weight", { data: { labels: weight.labels.map(shortDate), datasets }, options: baseOptions() }, "Log your weight on the Home tab to see the trend.");

  // Projection
  const pLen = projection.labels.length;
  const projSets = projection.series.map((s, i) => lineDS(cap(s.name), [...s.data.map(fromKg), ...Array(pLen - s.data.length).fill(null)], SERIES()[i]));
  if (projSets.length) projSets.push(refLineDS("Target", fromKg(projection.target_weight_kg), pLen));
  const projOpts = baseOptions();
  projOpts.scales.x.title = { display: true, text: "Weeks from today", color: cssVar("--text-2"), font: { size: 11 } };
  drawChart("c-proj", { data: { labels: projection.labels, datasets: projSets }, options: projOpts }, "You're at a healthy weight, so there's nothing to project.");

  // Calories
  const calSets = [barDS("Calories", calories.series[0].data, SERIES()[0])];
  if (calories.target_calories) calSets.push(refLineDS("Target", calories.target_calories, calories.labels.length));
  drawChart("c-cal", { data: { labels: calories.labels.map(shortDate), datasets: calSets }, options: baseOptions() }, "Log food to see your daily calories.");

  // Macros: stacked bars with a 2px surface gap between segments
  const surface = cssVar("--surface");
  const macroSets = calories.macros.map((m, i) => barDS(m.name, m.data, SERIES()[i], {
    borderRadius: i === calories.macros.length - 1 ? 4 : 0, borderColor: surface, borderWidth: { top: i ? 2 : 0 }, borderSkipped: "start",
  }));
  drawChart("c-macro", { data: { labels: calories.labels.map(shortDate), datasets: macroSets }, options: baseOptions({ stacked: true }) }, "Log food to see your macros.");

  // Lift progress
  const drawLift = async (id) => {
    charts.find((c) => c.canvas.id === "c-lift")?.destroy();
    const p = await api(`/analytics/exercise/${id}`);
    const box = $("#c-lift-box");
    if (!box.querySelector("canvas")) box.innerHTML = `<canvas id="c-lift" role="img" aria-label="Lift progress"></canvas>`;
    drawChart("c-lift", { data: { labels: p.labels.map(shortDate), datasets: [
      lineDS("Estimated 1RM", p.series[0].data.map(fromKg), SERIES()[0], { pointRadius: 3, pointStyle: "circle", pointBorderColor: surface, pointBorderWidth: 1.5 }),
      lineDS("Heaviest set", p.series[1].data.map(fromKg), SERIES()[1], { pointRadius: 3, pointStyle: "circle", pointBorderColor: surface, pointBorderWidth: 1.5 }),
    ] }, options: baseOptions() }, "No sets with weight logged for this exercise yet.");
  };
  if (lifts.length) { drawLift(lifts[0].id); $("#lift-pick").onchange = (e) => drawLift(e.target.value); }
  else $("#c-lift-box").outerHTML = `<div class="chart-empty" id="c-lift-box">Log a workout to see your strength progress.</div>`;

  // Weekly volume, stacked by region
  const volSets = volume.series.map((s, i) => barDS(s.name, s.data.map((v) => round(fromKg(v))), SERIES()[i], {
    borderRadius: 0, borderColor: surface, borderWidth: { top: i ? 2 : 0 },
  }));
  volSets[volSets.length - 1].borderRadius = 4;
  drawChart("c-vol", { data: { labels: volume.labels.map((l) => `Wk of ${shortDate(l)}`), datasets: volSets }, options: baseOptions({ stacked: true }) }, "Log workouts to see your weekly volume.");

  drawMeasureChart(compare);
  bindMeasurements();

  $("main").addEventListener("click", (e) => {
    const t = e.target.closest("[data-table]");
    if (!t) return;
    const el = $(`#${t.dataset.table}-table`);
    el.classList.toggle("hidden");
    t.textContent = el.classList.contains("hidden") ? "Table" : "Chart only";
  });
  $("#add-measure").onclick = openMeasurementForm;
}

const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

function measurementsHTML(cmp) {
  if (cmp.rows.length === 0) {
    return `<p class="muted center" style="margin:0">Add measurements (waist, shoulders…) at least once a month to compare months.${cmp.available_months.length === 1 ? " You have one month so far." : ""}</p>`;
  }
  const opts = (sel) => cmp.available_months.map((m) => `<option value="${m}" ${m === sel ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("");
  const unitFor = (field) => (field === "body_fat_pct" ? "%" : lUnit());
  const val = (field, v) => (v == null ? "–" : field === "body_fat_pct" ? fmt(v, 1) : fmt(fromCm(v), 1));
  return `
    <div class="grid2"><div><label for="m-a">Compare</label><select id="m-a">${opts(cmp.months[0])}</select></div>
      <div><label for="m-b">with</label><select id="m-b">${opts(cmp.months[1])}</select></div></div>
    <div class="chart-box mt" id="c-meas-box"><canvas id="c-meas" role="img" aria-label="Measurements by month"></canvas></div>
    <table class="data mt"><thead><tr><th></th><th>${esc(monthLabel(cmp.months[0]).split(" ")[0])}</th><th>${esc(monthLabel(cmp.months[1]).split(" ")[0])}</th><th>Change</th></tr></thead>
    <tbody>${cmp.rows.map((r) => {
      // Smaller waist/hips/body fat is usually the goal; bigger shoulders/chest/arms
      const goodWhenDown = ["waist_cm", "hips_cm", "body_fat_pct", "neck_cm"].includes(r.field);
      const cls = r.difference == null || r.difference === 0 ? "" : (r.difference < 0) === goodWhenDown ? "delta-good" : "delta-bad";
      const d = r.difference == null ? "–" : `${r.difference > 0 ? "+" : r.difference < 0 ? "−" : ""}${val(r.field, Math.abs(r.difference))} ${unitFor(r.field)}`;
      return `<tr><td>${esc(r.label)}</td><td>${val(r.field, r.first)}</td><td>${val(r.field, r.second)}</td><td class="${cls}">${d}</td></tr>`;
    }).join("")}</tbody></table>
    <p class="tiny muted">Body fat is estimated with the U.S. Navy formula from waist, neck${state.profile.sex === "female" ? ", hips" : ""} and height.</p>`;
}

function drawMeasureChart(cmp) {
  charts.find((c) => c.canvas.id === "c-meas")?.destroy();
  if (!cmp.rows.length || !$("#c-meas")) return;
  const rows = cmp.rows.filter((r) => r.field !== "body_fat_pct");
  const short = (m) => monthLabel(m).split(" ")[0];
  const config = { type: "bar", data: { labels: rows.map((r) => r.label), datasets: [
    barDS(short(cmp.months[0]), rows.map((r) => round(fromCm(r.first), 1)), SERIES()[0]),
    barDS(short(cmp.months[1]), rows.map((r) => round(fromCm(r.second), 1)), SERIES()[1]),
  ] }, options: baseOptions({ yTitle: lUnit() }) };
  charts.push(new Chart($("#c-meas"), config));
}

function bindMeasurements() {
  const reload = async () => {
    const a = $("#m-a")?.value, b = $("#m-b")?.value;
    const cmp = await api(`/measurements/compare${a && b ? `?months=${a},${b}` : ""}`);
    $("#measure-card").innerHTML = measurementsHTML(cmp);
    drawMeasureChart(cmp);
    bindMeasurements();
  };
  $("#m-a")?.addEventListener("change", reload);
  $("#m-b")?.addEventListener("change", reload);
}

const MEASURE_FIELDS = [["waist_cm", "Waist"], ["shoulders_cm", "Shoulders"], ["chest_cm", "Chest"], ["hips_cm", "Hips"], ["neck_cm", "Neck"], ["arm_cm", "Arm"], ["thigh_cm", "Thigh"]];

function openMeasurementForm() {
  const body = openSheet("Add measurements", `
    <p class="small text-2" style="margin-top:0">Fill in any you have, in ${lUnit()}. Measure in the morning, relaxed, tape snug but not tight.</p>
    <form id="measure-form">
      <label for="m-date">Date</label><input id="m-date" name="date" type="date" value="${todayISO()}" max="${todayISO()}">
      <div class="grid2">${MEASURE_FIELDS.map(([k, l]) => `<div><label for="${k}">${l}</label><input id="${k}" name="${k}" type="number" min="0" step="0.1"></div>`).join("")}</div>
      <p class="error hidden" id="m-err"></p>
      <button class="btn block mt">Save</button>
    </form>`);
  $("#measure-form", body).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = { date: f.date.value, unit: lUnit() };
    for (const [k] of MEASURE_FIELDS) payload[k] = f[k].value ? parseFloat(f[k].value) : null;
    try {
      await api("/measurements", { method: "POST", body: payload });
      closeSheet();
      toast("Measurements saved");
      renderProgress();
    } catch (err) { showError("#m-err", err.message); }
  });
}

// ---------------------------------------------------------------- profile tab

async function renderProfile() {
  shell("profile", "Profile", esc(state.me.email), `
    <div class="card">
      <h3>Emails</h3>
      <label class="check"><input type="checkbox" id="mkt" ${state.me.marketing_opt_in ? "checked" : ""}>
        <span>Send ads and discounts to <b>${esc(state.me.email)}</b></span></label>
    </div>
    ${profileFormHTML(state.profile)}
    <h2>Account</h2>
    <div class="card">
      <button class="btn ghost block" id="logout">Log out</button>
      <button class="btn danger block mt" id="delete">Delete my account and data</button>
    </div>
  `);
  $("#mkt").addEventListener("change", async (e) => {
    state.me = await api("/me/marketing", { method: "PUT", body: { opt_in: e.target.checked } });
    toast(e.target.checked ? "You'll get ads and discounts by email" : "Unsubscribed from ads and discounts");
  });
  bindProfileForm(() => { toast("Profile saved"); renderProfile(); });
  $("#logout").onclick = logout;
  $("#delete").onclick = async () => {
    if (!confirm("Delete your account and all your data? This cannot be undone.")) return;
    await api("/me", { method: "DELETE" });
    logout();
  };
}

// ---------------------------------------------------------------- start

route();
