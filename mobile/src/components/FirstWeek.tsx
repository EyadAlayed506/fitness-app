import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { todayISO } from "@/lib/format";
import { space, useTheme } from "@/lib/theme";
import type { GettingStarted } from "@/lib/types";

import { Card, Meter, Row, Txt, type IconName } from "./ui";

interface Step {
  done: boolean;
  icon: IconName;
  title: string;
  text: string;
  /** where to do it; none when it's done on this screen */
  go?: () => void;
}

/** A new user's first week: four small things that make the plan work, ticked off as they happen. */
export function FirstWeek({ data }: { data: GettingStarted }) {
  const t = useTheme();
  const weighedToday = data.first_weigh_in === todayISO();
  const steps: Step[] = [
    {
      done: data.weighed_in,
      icon: "scale-outline",
      title: weighedToday ? "Weigh in tomorrow morning" : "Log your weight",
      text: weighedToday
        ? "Today's weight is in from setting up. Same time each morning gives the clearest trend."
        : "Use Weigh-in below, ideally in the morning.",
    },
    {
      done: data.logged_food,
      icon: "restaurant-outline",
      title: "Log your first meal",
      text: "Search a food, or ask the coach: “log a banana for breakfast”.",
      go: () => router.navigate("/food"),
    },
    {
      done: data.finished_workout,
      icon: "barbell-outline",
      title: "Finish your first workout",
      text: "Start a session and log at least one set.",
      go: () => router.navigate("/workouts"),
    },
    {
      done: data.sleep_goal_set,
      icon: "moon-outline",
      title: "Set your sleep goal",
      text: "Pick how much sleep you're aiming for.",
      go: () => router.push("/sleep"),
    },
  ];
  const finished = steps.filter((s) => s.done).length;
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="h3">Your first week</Txt>
        <Txt variant="small">
          {finished} of {steps.length} done
        </Txt>
      </Row>
      <View style={{ marginTop: space.sm, marginBottom: space.xs }}>
        <Meter value={finished} max={steps.length} height={4} color={t.good} />
      </View>
      {steps.map((s, i) => {
        const content = (
          <>
            <Ionicons name={s.done ? "checkmark-circle" : s.icon} size={22} color={s.done ? t.good : t.text2} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: "600", color: s.done ? t.muted : t.text, textDecorationLine: s.done ? "line-through" : "none" }}>
                {s.title}
              </Txt>
              {s.done ? null : <Txt variant="small">{s.text}</Txt>}
            </View>
            {s.go && !s.done ? <Ionicons name="chevron-forward" size={18} color={t.muted} style={{ marginTop: 2 }} /> : null}
          </>
        );
        const style = [styles.step, { borderTopColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }];
        return s.go && !s.done ? (
          <Pressable key={s.title} onPress={s.go} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
            {content}
          </Pressable>
        ) : (
          <View key={s.title} style={style} accessibilityLabel={`${s.title}${s.done ? ", done" : ""}`}>
            {content}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.md, minHeight: 52 },
});
