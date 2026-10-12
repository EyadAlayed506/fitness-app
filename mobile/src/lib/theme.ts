import { useColorScheme } from "react-native";

/**
 * Design tokens. Every screen takes its colours, spacing, radii and type sizes from here,
 * so the app stays consistent and dark mode is a separate, deliberately chosen palette.
 *
 * Colour roles:
 * - ink: primary actions and the most important numbers (near-black / near-white)
 * - accent (cobalt): progress, the active tab, links and selected options. One accent only.
 * - good / warn / critical: status only, always with text or an icon, never decoration
 * - Text colours (text, text2, muted, accent, *Ink, critical) keep at least 4.5:1 contrast on bg, surface
 *   and surface2 in both palettes. Check new colours before adding them.
 * - series: chart colours, a colour-blind-checked order. Use them in this order, for data only.
 */
const light = {
  dark: false,
  bg: "#f4f4f1", // app background, warm grey
  surface: "#ffffff", // cards and sheets
  surface2: "#eeeeea", // inputs, tracks, quiet fills
  border: "#e3e2dd", // hairlines
  text: "#121315",
  text2: "#53555b",
  muted: "#67696f", // at least 4.5:1 on bg, surface and surface2
  ink: "#121315", // primary buttons
  inkText: "#ffffff",
  accent: "#2f64d8",
  accentInk: "#ffffff",
  accentSoft: "#e6edfb",
  good: "#1f8a3c",
  goodInk: "#16672c",
  goodSoft: "#e4f3e7",
  warn: "#d99211",
  warnInk: "#8a5a00",
  warnSoft: "#fbf0d9",
  critical: "#bf2f2f",
  criticalSoft: "#fbe5e5",
  grid: "#ebeae6",
  shadow: "rgba(18, 19, 21, 0.06)",
  overlay: "rgba(10, 11, 13, 0.45)",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
};

const dark: typeof light = {
  dark: true,
  bg: "#0d0e10",
  surface: "#17181b",
  surface2: "#222327",
  border: "#2b2c31",
  text: "#f2f2f0",
  text2: "#b8b9bf",
  muted: "#8f9097",
  ink: "#f2f2f0",
  inkText: "#121315",
  accent: "#5b8cf5",
  accentInk: "#0d0e10",
  accentSoft: "#1b2640",
  good: "#3fb45f",
  goodInk: "#6fd38a",
  goodSoft: "#14291b",
  warn: "#e2a336",
  warnInk: "#f0c06a",
  warnSoft: "#2e2410",
  critical: "#e5605f",
  criticalSoft: "#341b1b",
  grid: "#26272b",
  shadow: "rgba(0, 0, 0, 0)",
  overlay: "rgba(0, 0, 0, 0.6)",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"],
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** 4-point spacing scale. Screen gutters are `lg`; space between sections is `xl`. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Corner radii: small controls, inputs and buttons, cards, sheets. */
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

/** Type scale. Sizes and weights only; colours come from the theme. */
export const type = {
  display: { fontSize: 34, fontWeight: "700", letterSpacing: -0.8, lineHeight: 38 },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4, lineHeight: 30 },
  heading: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: "400", lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  small: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
  overline: { fontSize: 12, fontWeight: "600", letterSpacing: 0.4, lineHeight: 16 },
} as const;

/** Control sizes. Touch targets are at least 44 points. */
export const size = {
  touch: 44,
  button: 50,
  buttonSmall: 36,
  input: 50,
  icon: 20,
  iconSmall: 16,
  tabBar: 56,
} as const;

/** Motion: short and only for feedback. Durations in milliseconds. */
export const motion = { fast: 120, base: 200, slow: 280 } as const;
