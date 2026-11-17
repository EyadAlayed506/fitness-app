import { useState } from "react";
import { ActivityIndicator, Image, StyleSheet, View } from "react-native";

import { haptics } from "@/lib/haptics";
import { choosePhoto, sendPhoto, type Photo } from "@/lib/photo";
import { errorMessage } from "@/lib/query";
import { radius, space, useTheme } from "@/lib/theme";
import type { WeightReading } from "@/lib/types";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";

/** Helper in the set form: read the weight from a photo. */

const confidenceLabel = (c: number) =>
  c >= 0.7 ? { label: "Likely", tone: "good" as const } : c >= 0.4 ? { label: "Not sure", tone: "warn" as const } : { label: "Guess", tone: "neutral" as const };

// ---------- snap the weight ----------

const KIND_TEXT: Record<WeightReading["kind"], string> = {
  pin_stack: "Weight stack",
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  other: "Weight",
};

/** Read the weight from a photo of the pin, the bar or the dumbbell. The user always confirms it. */
export function WeightFromPhoto({ onUse, onClose }: { onUse: (weight: number, unit: "kg" | "lb" | null) => void; onClose: () => void }) {
  const t = useTheme();
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
        <Txt variant="label">Weight from a photo</Txt>
        <LinkButton title="Close" onPress={onClose} />
      </Row>
      {!photo ? (
        <>
          <Txt variant="small" style={{ marginTop: space.xs }}>
            Photograph the pin in the weight stack, the loaded bar, or the dumbbell. You check the number before it&apos;s used.
          </Txt>
          <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
            <Button title="Take a photo" icon="camera-outline" small onPress={() => take("camera")} />
            <Button title="Choose one" icon="image-outline" kind="ghost" small onPress={() => take("library")} />
          </Row>
        </>
      ) : (
        <Row gap={space.md} style={{ marginTop: space.sm, alignItems: "flex-start" }}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} accessibilityLabel="Your photo of the weight" />
          <View style={{ flex: 1 }}>
            {loading ? (
              <Row gap={space.sm}>
                <ActivityIndicator size="small" color={t.muted} />
                <Txt variant="small" style={{ flex: 1 }}>
                  Reading the weight…
                </Txt>
              </Row>
            ) : reading?.weight != null ? (
              <>
                <Row gap={space.sm} style={{ flexWrap: "wrap" }}>
                  <Txt variant="h3">
                    {reading.weight} {reading.unit ?? ""}
                  </Txt>
                  <Badge label={confidenceLabel(reading.confidence).label} tone={confidenceLabel(reading.confidence).tone} />
                </Row>
                <Txt variant="tiny" style={{ marginTop: 2 }}>
                  {KIND_TEXT[reading.kind]}
                  {reading.details ? ` · ${reading.details}` : ""}
                  {reading.unit ? "" : " · unit not shown, your unit is used"}
                </Txt>
                <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
                  <Button
                    title={`Use ${reading.weight}${reading.unit ? ` ${reading.unit}` : ""}`}
                    icon="checkmark"
                    small
                    onPress={() => {
                      onUse(reading.weight as number, reading.unit);
                      haptics.selection();
                    }}
                  />
                  <Button title="Not right" kind="ghost" small onPress={() => take("camera")} />
                </Row>
              </>
            ) : reading ? (
              <Txt variant="small">
                Couldn&apos;t read a weight{reading.details ? `: ${reading.details}` : "."} Try a closer photo, or type it in.
              </Txt>
            ) : null}
            <ErrorText message={error} />
            {reading?.weight == null && !loading ? (
              <Row gap={space.lg} style={{ marginTop: space.sm, flexWrap: "wrap" }}>
                <LinkButton title="Another photo" onPress={() => take("camera")} />
                <LinkButton title="Choose one" onPress={() => take("library")} />
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
