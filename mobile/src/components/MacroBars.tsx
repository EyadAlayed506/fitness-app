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
