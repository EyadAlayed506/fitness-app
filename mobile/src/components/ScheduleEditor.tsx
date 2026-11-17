import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { WEEKDAYS } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import type { Routine } from "@/lib/types";

import { DayPicker } from "./DayPicker";
import { Button, Chips, ErrorText, Field, LinkButton, Row, Txt } from "./ui";

/** focus null = use the recommended session for that day; name "" = named after the session */
type Choice = { focus: string | null; name: string };

const fromRoutine = (r: Routine): Record<number, Choice> =>
  Object.fromEntries(
    r.days.map((d) => [d.weekday_index, { focus: d.focus === d.recommended_focus ? null : d.focus, name: d.custom_name ? d.title : "" }]),
  );

/**
 * Change the plan freely: which days, what each day trains, and a name for each day.
 * The recommendation for each day is shown next to the choice and is one tap away.
 */
export function ScheduleEditor({ routine, onSaved }: { routine: Routine; onSaved: (r: Routine, message: string) => void }) {
  const t = useTheme();
  const { t: tr, errorText } = useI18n();
  const [days, setDays] = useState<number[]>(routine.training_days);
  const [choices, setChoices] = useState<Record<number, Choice>>(() => fromRoutine(routine));
  const [preview, setPreview] = useState<Routine>(routine);
  const [error, setError] = useState<{ key: "profile.needDays" } | { error: unknown } | null>(null);

  const body = useMemo(
    () => ({
      days: days.map((d) => ({ weekday: d, focus: choices[d]?.focus ?? null, name: choices[d]?.name || null })),
    }),
    [days, choices],
  );

  // Ask the server what this plan gives (recommendations, names, notes) without saving it
  useEffect(() => {
    if (!days.length) return;
    const id = setTimeout(() => {
      api<Routine>("/me/schedule/preview", { method: "POST", body })
        .then((r) => {
          setError(null);
          setPreview(r);
        })
        .catch((e) => setError({ error: e }));
    }, 250);
    return () => clearTimeout(id);
  }, [body, days.length]);

  const byDay = new Map(preview.days.map((d) => [d.weekday_index, d]));
  const label = (focus: string) => routine.focus_options.find((o) => o.value === focus)?.label ?? focus;
  const set = (d: number, change: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [d]: { focus: c[d]?.focus ?? null, name: c[d]?.name ?? "", ...change } }));

  const save = async () => {
    if (!days.length) {
      setError({ key: "profile.needDays" });
      return;
    }
    try {
      onSaved(await api<Routine>("/me/schedule", { method: "PUT", body }), tr("schedule.saved"));
    } catch (e) {
      setError({ error: e });
    }
  };

  return (
    <View>
      <DayPicker value={days} onChange={setDays} />
      {days.map((d) => {
        const planned = byDay.get(d);
        const recommended = planned?.recommended_focus;
        const current = choices[d]?.focus ?? recommended ?? "full_body";
        return (
          <View key={d} style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.border }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={{ fontWeight: "700" }}>{WEEKDAYS[d]}</Txt>
              {recommended && current !== recommended ? (
                <LinkButton title={tr("schedule.useRecommendedFor", { label: label(recommended) })} onPress={() => set(d, { focus: null })} />
              ) : recommended ? (
                <Txt variant="tiny">{tr("schedule.recommended")}</Txt>
              ) : null}
            </Row>
            <Chips
              value={current}
              onChange={(focus) => set(d, { focus: focus === recommended ? null : focus })}
              options={routine.focus_options.map((o) => ({
                value: o.value,
                label: o.value === recommended ? `${o.label} ★` : o.label,
              }))}
              style={{ marginTop: 4 }}
            />
            <Field
              label={tr("schedule.name")}
              value={choices[d]?.name ?? ""}
              onChangeText={(name) => set(d, { name })}
              placeholder={label(current)}
              maxLength={40}
              accessibilityLabel={tr("schedule.nameFor", { day: WEEKDAYS[d] })}
            />
          </View>
        );
      })}
      <Txt variant="tiny" style={{ marginTop: 10 }}>
        {tr("schedule.star")} {preview.split_reason}
      </Txt>
      {preview.warnings.map((w) => (
        <Txt key={w} variant="small" style={{ marginTop: 6, color: t.warnInk }}>
          {w}
        </Txt>
      ))}
      <ErrorText message={error == null ? null : "key" in error ? tr(error.key) : errorText(error.error)} />
      <Row style={{ marginTop: 14 }}>
        <Button
          title={tr("schedule.useRecommended")}
          kind="ghost"
          onPress={() => setChoices(Object.fromEntries(days.map((d) => [d, { focus: null, name: "" }])))}
        />
        <Button title={tr("schedule.save")} onPress={save} style={{ flex: 1 }} />
      </Row>
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        {tr("schedule.never")}
      </Txt>
    </View>
  );
}
