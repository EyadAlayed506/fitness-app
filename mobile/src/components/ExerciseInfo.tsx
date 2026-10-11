import { useEffect, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { cap } from "@/lib/format";
import { formatRest } from "@/lib/restTimer";
import { useTheme } from "@/lib/theme";
import type { Exercise, ExerciseAlternative, ExerciseAlternatives } from "@/lib/types";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";
import type { PickedExercise } from "./WorkoutParts";

const EQUIPMENT_LABEL: Record<string, string> = { gym: "a gym", home: "dumbbells at home", bodyweight: "no equipment" };

/** Numbered how-to cues from the curated library. */
export function Instructions({ exercise }: { exercise: Exercise }) {
  if (!exercise.instructions.length) return <Txt variant="muted">No instructions for this exercise yet.</Txt>;
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
  const [allEquipment, setAllEquipment] = useState(false);
  const [data, setData] = useState<ExerciseAlternatives | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ExerciseAlternatives>(`/exercises/${exerciseId}/alternatives?all_equipment=${allEquipment}`)
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch((e) => setError((e as Error).message));
  }, [exerciseId, allEquipment]);

  if (error) return <ErrorText message={error} />;
  if (!data) return <Txt variant="muted">Loading…</Txt>;
  const ex = data.exercise;
  const similar = data.alternatives.filter((a) => a.match === "similar");
  const different = data.alternatives.filter((a) => a.match === "different");

  return (
    <View>
      <Txt variant="small">
        {cap(ex.muscle_group)} · {ex.category}
        {ex.primary_muscles ? ` · ${ex.primary_muscles}` : ""}
      </Txt>
      <Txt variant="label" style={{ marginTop: 14, marginBottom: 6 }}>
        How to do it
      </Txt>
      <Instructions exercise={ex} />
      <Txt variant="tiny" style={{ marginTop: 8 }}>
        Suggested rest between sets: {formatRest(ex.default_rest_seconds * 1000)} (you can change it in the rest timer).
      </Txt>

      <Txt variant="label" style={{ marginTop: 18 }}>
        Alternatives
      </Txt>
      <Txt variant="tiny" style={{ marginTop: 2 }}>
        {data.filtered_by_equipment && data.equipment
          ? `Only exercises you can do with ${EQUIPMENT_LABEL[data.equipment] ?? data.equipment}.`
          : "Exercises for any equipment."}
      </Txt>
      <View style={{ marginTop: 4 }}>
        <LinkButton
          title={allEquipment ? "Only show my equipment" : "Include other equipment"}
          onPress={() => setAllEquipment((v) => !v)}
        />
      </View>
      {similar.length ? (
        similar.map((a) => <AlternativeRow key={a.exercise.id} alt={a} onUse={onUse} />)
      ) : (
        <Txt variant="muted" style={{ marginTop: 10 }}>
          No exercise in the library uses the same movement{data.filtered_by_equipment ? " with your equipment" : ""}.
        </Txt>
      )}
      {different.length ? (
        <>
          <Txt variant="small" style={{ marginTop: 14 }}>
            Same muscles, different movement. These train the same area but aren’t a like-for-like swap:
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
  const [open, setOpen] = useState(false);
  const ex = alt.exercise;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 10, marginTop: 6 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={{ fontWeight: "700", flex: 1 }}>{ex.name}</Txt>
        <Badge label={alt.match === "similar" ? "Similar movement" : "Different movement"} tone={alt.match === "similar" ? "good" : "warn"} />
      </Row>
      <Txt variant="tiny">
        {cap(ex.muscle_group)} · {ex.category}
      </Txt>
      {[...alt.reasons, ...alt.differences].map((line) => (
        <Txt key={line} variant="small" style={{ marginTop: 3 }}>
          • {line}
        </Txt>
      ))}
      <Row style={{ marginTop: 8 }} gap={14}>
        <LinkButton title={open ? "Hide how to do it" : "How to do it"} onPress={() => setOpen((v) => !v)} />
        {onUse ? <Button title="Use this instead" kind="soft" small onPress={() => onUse({ id: ex.id, name: ex.name })} /> : null}
      </Row>
      {open ? (
        <View style={{ marginTop: 8 }}>
          <Instructions exercise={ex} />
        </View>
      ) : null}
    </View>
  );
}
