import { View } from "react-native";

import { fmt } from "@/lib/format";
import { space, useTheme } from "@/lib/theme";
import type { Totals } from "@/lib/types";

import { Meter, Txt } from "./ui";

/**
 * Protein / carbs / fat eaten vs rough targets (30% / 40% / 30% of the calorie target).
 * `stacked` puts them one under another (next to the calorie ring on Home).
 */
export function MacroBars({ totals, targetKcal, stacked = false }: { totals: Totals; targetKcal: number; stacked?: boolean }) {
  const t = useTheme();
  const rows = [
    { label: "Protein", eaten: totals.protein_g, goal: (targetKcal * 0.3) / 4, color: t.series[0] },
    { label: "Carbs", eaten: totals.carbs_g, goal: (targetKcal * 0.4) / 4, color: t.series[1] },
    { label: "Fat", eaten: totals.fat_g, goal: (targetKcal * 0.3) / 9, color: t.series[2] },
  ];
  return (
    <View style={stacked ? { gap: space.md } : { flexDirection: "row", gap: space.md, marginTop: space.lg }}>
      {rows.map((r) => (
        <View key={r.label} style={stacked ? undefined : { flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 4 }}>
            <Txt variant="tiny" numberOfLines={1}>
              {r.label}
            </Txt>
            <Txt variant="tiny" style={{ color: t.text, fontWeight: "600" }} numberOfLines={1}>
              {fmt(r.eaten)}
              <Txt variant="tiny">/{fmt(r.goal)} g</Txt>
            </Txt>
          </View>
          <Meter value={r.eaten} max={r.goal} color={r.color} height={4} />
        </View>
      ))}
    </View>
  );
}

/** a space a line never breaks at */
const NBSP = String.fromCharCode(160);

/**
 * "9 g protein  47 g carbs  5 g fat" for one food, each with a dot in the same colour as its bar.
 * Text (not views), so it can sit inside a line of text such as a list row's subtitle.
 */
export function MacroText({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const t = useTheme();
  const parts = [
    { label: "protein", grams: protein, color: t.series[0] },
    { label: "carbs", grams: carbs, color: t.series[1] },
    { label: "fat", grams: fat, color: t.series[2] },
  ];
  return (
    <>
      {parts.map((p) => (
        <Txt key={p.label} variant="small" style={{ color: t.muted }}>
          {"  "}
          <Txt variant="small" style={{ color: p.color }}>
            ●
          </Txt>
          {/* no-break spaces: a line only wraps between nutrients, never inside "5 g fat" */}
          {["", fmt(p.grams), "g", p.label].join(NBSP)}
        </Txt>
      ))}
    </>
  );
}
