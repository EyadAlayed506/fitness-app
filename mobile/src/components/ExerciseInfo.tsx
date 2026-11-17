import { useEffect, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { idLabel } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRest } from "@/lib/restTimer";
import { useTheme } from "@/lib/theme";
import type { Exercise, ExerciseAlternative, ExerciseAlternatives } from "@/lib/types";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";
import type { PickedExercise } from "./WorkoutParts";

const EQUIPMENT_LABEL = { gym: "exercise.equip.gym", home: "exercise.equip.home", bodyweight: "exercise.equip.bodyweight" } as const;

/** Numbered how-to cues from the curated library. */
export function Instructions({ exercise }: { exercise: Exercise }) {
  const { t: tr } = useI18n();
  if (!exercise.instructions.length) return <Txt variant="muted">{tr("exercise.noInstructions")}</Txt>;
  return (
    <View style={{ gap: 4 }}>
      {exercise.instructions.map((step, i) => (
        <Row key={step} gap={6} style={{ alignItems: "flex-start" }}>
          <Txt variant="small" style={{ width: 16 }}>
            {i + 1}.
          </Txt>
          <Txt variant="small" style={{ flex: 1 }}>
            {step}
          </Txt>
        </Row>
      ))}
    </View>
  );
}

/** How to do an exercise, and what to do instead when its machine or equipment isn't free. */
export function ExerciseInfo({ exerciseId, onUse }: { exerciseId: number; onUse?: (e: PickedExercise) => void }) {
  const { t: tr, errorText } = useI18n();
  const [allEquipment, setAllEquipment] = useState(false);
  const [data, setData] = useState<ExerciseAlternatives | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<ExerciseAlternatives>(`/exercises/${exerciseId}/alternatives?all_equipment=${allEquipment}`)
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch((e) => setError(e));
  }, [exerciseId, allEquipment]);

  if (error) return <ErrorText message={errorText(error)} />;
  if (!data) return <Txt variant="muted">{tr("common.loadingDots")}</Txt>;
  const ex = data.exercise;
  const similar = data.alternatives.filter((a) => a.match === "similar");
  const different = data.alternatives.filter((a) => a.match === "different");

  return (
    <View>
      <Txt variant="small">
        {idLabel("muscle", ex.muscle_group)} · {idLabel("category", ex.category)}
        {ex.primary_muscles ? ` · ${ex.primary_muscles}` : ""}
      </Txt>
      <Txt variant="label" style={{ marginTop: 14, marginBottom: 6 }}>
        {tr("sets.howTo")}
      </Txt>
      <Instructions exercise={ex} />
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        {tr("exercise.suggestedRest", { time: formatRest(ex.default_rest_seconds * 1000) })}
      </Txt>

      <Txt variant="label" style={{ marginTop: 18 }}>
        {tr("exercise.alternatives")}
      </Txt>
      <Txt variant="tiny" style={{ marginTop: 2 }}>
        {data.filtered_by_equipment && data.equipment
          ? tr("exercise.onlyWith", { equipment: data.equipment in EQUIPMENT_LABEL ? tr(EQUIPMENT_LABEL[data.equipment as keyof typeof EQUIPMENT_LABEL]) : data.equipment })
          : tr("exercise.anyEquipment")}
      </Txt>
      <View style={{ marginTop: 4 }}>
        <LinkButton
          title={tr(allEquipment ? "exercise.onlyMine" : "exercise.includeOther")}
          onPress={() => setAllEquipment((v) => !v)}
        />
      </View>
      {similar.length ? (
        similar.map((a) => <AlternativeRow key={a.exercise.id} alt={a} onUse={onUse} />)
      ) : (
        <Txt variant="muted" style={{ marginTop: 10 }}>
          {tr(data.filtered_by_equipment ? "exercise.noSameMine" : "exercise.noSame")}
        </Txt>
      )}
      {different.length ? (
        <>
          <Txt variant="small" style={{ marginTop: 14 }}>
            {tr("exercise.differentIntro")}
          </Txt>
          {different.map((a) => (
            <AlternativeRow key={a.exercise.id} alt={a} onUse={onUse} />
          ))}
        </>
      ) : null}
    </View>
  );
}

function AlternativeRow({ alt, onUse }: { alt: ExerciseAlternative; onUse?: (e: PickedExercise) => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(false);
  const ex = alt.exercise;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 10, marginTop: 6 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={{ fontWeight: "700", flex: 1 }}>{ex.name}</Txt>
        <Badge label={tr(alt.match === "similar" ? "exercise.similar" : "exercise.different")} tone={alt.match === "similar" ? "good" : "warn"} />
      </Row>
      <Txt variant="tiny">
        {idLabel("muscle", ex.muscle_group)} · {idLabel("category", ex.category)}
      </Txt>
      {[...alt.reasons, ...alt.differences].map((line) => (
        <Txt key={line} variant="small" style={{ marginTop: 3 }}>
          • {line}
        </Txt>
      ))}
      <Row style={{ marginTop: 8 }} gap={14}>
        <LinkButton title={tr(open ? "exercise.hideHowTo" : "sets.howTo")} onPress={() => setOpen((v) => !v)} />
        {onUse ? <Button title={tr("exercise.useInstead")} kind="soft" small onPress={() => onUse({ id: ex.id, name: ex.name })} /> : null}
      </Row>
      {open ? (
        <View style={{ marginTop: 8 }}>
          <Instructions exercise={ex} />
        </View>
      ) : null}
    </View>
  );
}
