import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { todayISO } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { space, useTheme } from "@/lib/theme";
import type { GettingStarted } from "@/lib/types";

import { Card, Icon, Meter, Row, Txt, type IconName } from "./ui";

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
  const { t: tr } = useI18n();
  const weighedToday = data.first_weigh_in === todayISO();
  const steps: Step[] = [
    {
      done: data.weighed_in,
      icon: "scale-outline",
      title: tr(weighedToday ? "first.weighTomorrow" : "first.logWeight"),
      text: tr(weighedToday ? "first.weighedText" : "first.logWeightText"),
    },
    {
      done: data.logged_food,
      icon: "restaurant-outline",
      title: tr("first.meal"),
      text: tr("first.mealText"),
      go: () => router.navigate("/food"),
    },
    {
      done: data.finished_workout,
      icon: "barbell-outline",
      title: tr("first.workout"),
      text: tr("first.workoutText"),
      go: () => router.navigate("/workouts"),
    },
    {
      done: data.sleep_goal_set,
      icon: "moon-outline",
      title: tr("first.sleep"),
      text: tr("first.sleepText"),
      go: () => router.push("/sleep"),
    },
  ];
  const finished = steps.filter((s) => s.done).length;
  return (
    <Card>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="h3">{tr("first.title")}</Txt>
        <Txt variant="small">
          {tr("first.progress", { done: finished, total: steps.length })}
        </Txt>
      </Row>
      <View style={{ marginTop: space.sm, marginBottom: space.xs }}>
        <Meter value={finished} max={steps.length} height={4} color={t.good} />
      </View>
      {steps.map((s, i) => {
        const content = (
          <>
            <Icon name={s.done ? "checkmark-circle" : s.icon} size={22} color={s.done ? t.good : t.text2} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: "600", color: s.done ? t.muted : t.text, textDecorationLine: s.done ? "line-through" : "none" }}>
                {s.title}
              </Txt>
              {s.done ? null : <Txt variant="small">{s.text}</Txt>}
            </View>
            {s.go && !s.done ? <Icon name="chevron-forward" size={18} color={t.muted} style={{ marginTop: 2 }} /> : null}
          </>
        );
        const style = [styles.step, { borderTopColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }];
        return s.go && !s.done ? (
          <Pressable key={s.icon} onPress={s.go} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
            {content}
          </Pressable>
        ) : (
          <View key={s.icon} style={style} accessibilityLabel={s.done ? tr("common.done", { title: s.title }) : s.title}>
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
