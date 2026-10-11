import { useColorScheme } from "react-native";

// Same palette as the web preview. Series colors are a colorblind-checked order: use them in this order.
const light = {
  dark: false,
  bg: "#f3f3f1",
  surface: "#fcfcfb",
  surface2: "#f0efec",
  border: "#e2e1dc",
  text: "#0b0b0b",
  text2: "#52514e",
  muted: "#8a8984",
  accent: "#2a78d6",
  accentInk: "#ffffff",
  accentSoft: "#e3effc",
  good: "#0ca30c",
  goodInk: "#006300",
  warn: "#fab219",
  warnInk: "#8a5a00",
  critical: "#d03b3b",
  grid: "#e9e8e4",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"],
};

const dark: typeof light = {
  dark: true,
  bg: "#111110",
  surface: "#1a1a19",
  surface2: "#242423",
  border: "#2e2e2c",
  text: "#f0efec",
  text2: "#c3c2b7",
  muted: "#8f8e86",
  accent: "#3987e5",
  accentInk: "#ffffff",
  accentSoft: "#1b2c44",
  good: "#0ca30c",
  goodInk: "#5fd35f",
  warn: "#fab219",
  warnInk: "#fab219",
  critical: "#d03b3b",
  grid: "#2a2a28",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"],
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
