import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";

import { haptics } from "@/lib/haptics";
import { useI18n, type MessageKey } from "@/lib/i18n";
import { choosePhoto, sendPhoto, type Photo } from "@/lib/photo";
import { errorMessage } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { WeightReading } from "@/lib/types";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";

/** Helper in the set form: read the weight from a photo. */

const confidenceLabel = (c: number) =>
  c >= 0.7
    ? { label: "weightPhoto.likely" as const, tone: "good" as const }
    : c >= 0.4
      ? { label: "weightPhoto.notSure" as const, tone: "warn" as const }
      : { label: "weightPhoto.guess" as const, tone: "neutral" as const };

// ---------- snap the weight ----------

const KIND_TEXT: Record<WeightReading["kind"], MessageKey> = {
  pin_stack: "weightPhoto.pin_stack",
  barbell: "weightPhoto.barbell",
  dumbbell: "weightPhoto.dumbbell",
  other: "weightPhoto.other",
};

/** Read the weight from a photo of the pin, the bar or the dumbbell. The user always confirms it. */
export function WeightFromPhoto({ onUse, onClose }: { onUse: (weight: number, unit: "kg" | "lb" | null) => void; onClose: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [reading, setReading] = useState<WeightReading | null>(null);
  const [error, setError] = useState<string | null>(null);

  const take = async (source: "camera" | "library") => {
    setError(null);
    setReading(null);
    try {
      const p = await choosePhoto(source);
      if (!p) return;
      setPhoto(p);
      setReading(await sendPhoto<WeightReading>("/snap/weight", p));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const loading = !!photo && !reading && !error;
  return (
    <View style={[styles.panel, { backgroundColor: t.surface2 }]}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt variant="label">{tr("sets.weightFromPhoto")}</Txt>
        <LinkButton title={tr("common.close")} onPress={onClose} />
      </Row>
      {!photo ? (
        <>
          <Txt variant="small" style={{ marginTop: space.xs }}>
            {tr("weightPhoto.intro")}
          </Txt>
          <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
            <Button title={tr("weightPhoto.take")} icon="camera-outline" small onPress={() => take("camera")} />
            <Button title={tr("weightPhoto.choose")} icon="image-outline" kind="ghost" small onPress={() => take("library")} />
          </Row>
        </>
      ) : (
        <Row gap={space.md} style={{ marginTop: space.sm, alignItems: "flex-start" }}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel={tr("weightPhoto.photoLabel")} />
          <View style={{ flex: 1 }}>
            {loading ? (
              <Row gap={space.sm}>
                <ActivityIndicator size="small" color={t.muted} />
                <Txt variant="small" style={{ flex: 1 }}>
                  {tr("weightPhoto.reading")}
                </Txt>
              </Row>
            ) : reading?.weight != null ? (
              <>
                <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
                  <Txt variant="h3">
                    {reading.weight} {reading.unit ?? ""}
                  </Txt>
                  <Badge label={tr(confidenceLabel(reading.confidence).label)} tone={confidenceLabel(reading.confidence).tone} />
                </Row>
                <Txt variant="tiny" style={{ marginTop: 2 }}>
                  {tr(KIND_TEXT[reading.kind])}
                  {reading.details ? ` · ${reading.details}` : ""}
                  {reading.unit ? "" : tr("weightPhoto.noUnit")}
                </Txt>
                <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
                  <Button
                    title={tr("weightPhoto.use", { weight: `${reading.weight}${reading.unit ? ` ${tr(reading.unit === "lb" ? "unit.lb" : "unit.kg")}` : ""}` })}
                    icon="checkmark"
                    small
                    onPress={() => {
                      onUse(reading.weight as number, reading.unit);
                      haptics.selection();
                    }}
                  />
                  <Button title={tr("weightPhoto.notRight")} kind="ghost" small onPress={() => take("camera")} />
                </Row>
              </>
            ) : reading ? (
              <Txt variant="small">
                {reading.details ? tr("weightPhoto.couldntReadWhy", { details: reading.details }) : tr("weightPhoto.couldntRead")}
              </Txt>
            ) : null}
            <ErrorText message={error} />
            {reading?.weight == null && !loading ? (
              <Row gap={space.lg} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
                <LinkButton title={tr("weightPhoto.another")} onPress={() => take("camera")} />
                <LinkButton title={tr("weightPhoto.choose")} onPress={() => take("library")} />
              </Row>
            ) : null}
          </View>
        </Row>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.md, padding: space.md, marginTop: space.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
});
