import { View } from "react-native";

import { fmt } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { Totals } from "@/lib/types";

import { Meter, Txt } from "./ui";

/** Protein / carbs / fat eaten vs rough targets (30% / 40% / 30% of the calorie target). */
export function MacroBars({ totals, targetKcal }: { totals: Totals; targetKcal: number }) {
  const t = useTheme();
  const rows = [
    { label: "Protein", eaten: totals.protein_g, goal: (targetKcal * 0.3) / 4, color: t.series[0] },
    { label: "Carbs", eaten: totals.carbs_g, goal: (targetKcal * 0.4) / 4, color: t.series[1] },
    { label: "Fat", eaten: totals.fat_g, goal: (targetKcal * 0.3) / 9, color: t.series[2] },
  ];
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
      {rows.map((r) => (
        <View key={r.label} style={{ flex: 1 }}>
          <Txt variant="small">{r.label}</Txt>
          <Txt style={{ fontWeight: "700", marginBottom: 4 }}>
            {fmt(r.eaten)} <Txt variant="tiny">/ {fmt(r.goal)} g</Txt>
          </Txt>
          <Meter value={r.eaten} max={r.goal} color={r.color} height={6} />
        </View>
      ))}
    </View>
  );
}
