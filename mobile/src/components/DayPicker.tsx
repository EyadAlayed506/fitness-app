import { Pressable, Text, View } from "react-native";

import { WEEKDAYS, WEEKDAYS_SHORT, dayList } from "@/lib/format";
import { useTheme } from "@/lib/theme";

import { Txt } from "./ui";

export const MAX_TRAINING_DAYS = 6; // same rule as the backend: at least one rest day

/** Pick the weekdays you train. Any combination of up to six days. */
export function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const t = useTheme();
  const toggle = (d: number) => {
    if (value.includes(d)) onChange(value.filter((x) => x !== d));
    else if (value.length < MAX_TRAINING_DAYS) onChange([...value, d].sort((a, b) => a - b));
  };
  const rest = [0, 1, 2, 3, 4, 5, 6].filter((d) => !value.includes(d));
  return (
    <View style={{ marginTop: 10 }}>
      <Txt variant="label" style={{ marginBottom: 6 }}>
        Which days can you train?
      </Txt>
      <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="none">
        {WEEKDAYS_SHORT.map((label, d) => {
          const on = value.includes(d);
          const disabled = !on && value.length >= MAX_TRAINING_DAYS;
          return (
            <Pressable
              key={label}
              onPress={() => toggle(d)}
              accessibilityRole="checkbox"
              accessibilityLabel={WEEKDAYS[d]}
              aria-checked={on}
              aria-disabled={disabled}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? t.ink : t.surface2,
                opacity: disabled ? 0.4 : 1,
              }}
            >
              <Text style={{ color: on ? t.inkText : t.text, fontWeight: on ? "600" : "500", fontSize: 13 }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Txt variant="tiny" style={{ marginTop: 6 }}>
        {value.length === 0
          ? "Tap the days you're available. Your plan puts workouts only on these days."
          : `${value.length} training day${value.length === 1 ? "" : "s"} a week: ${dayList(value)}. Rest: ${rest.length ? dayList(rest) : "none"}.`}
        {value.length >= MAX_TRAINING_DAYS ? " Up to 6 days, so you keep at least one rest day." : ""}
      </Txt>
    </View>
  );
}
