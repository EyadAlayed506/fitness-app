import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { haptics } from "@/lib/haptics";
import { choosePhoto, sendPhoto, type Photo } from "@/lib/photo";
import { errorMessage } from "@/lib/query";
import { speak } from "@/lib/speech";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { WeightReading } from "@/lib/types";
import { useHoldToTalk } from "@/lib/voice";
import { parseSpokenSet, type SpokenSet } from "@/lib/voiceSet";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";

/** Helpers in the set form: say the set out loud (hands-free), or read the weight from a photo. */

const confidenceLabel = (c: number) =>
  c >= 0.7 ? { label: "Likely", tone: "good" as const } : c >= 0.4 ? { label: "Not sure", tone: "warn" as const } : { label: "Guess", tone: "neutral" as const };

// ---------- hands-free sets ----------

/**
 * Hold the mic and say "8 reps at 60" or "same again"; let go and the set is saved. The app answers out
 * loud (through headphones if they're connected), and says the next set when the rest is over.
 */
export function HandsFreeMic({
  onSet,
  disabled = false,
}: {
  /** a set was heard; returns what to say back ("Saved: …"), or an error to show and say */
  onSet: (set: SpokenSet, heard: string) => Promise<{ said: string } | { error: string }>;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const fail = (text: string) => {
    setNote({ text, error: true });
    void speak(text);
  };
  const talk = useHoldToTalk(
    async (text) => {
      const heard = text.trim();
      const set = parseSpokenSet(heard);
      if (!set) {
        fail(heard ? `Heard “${heard}”. Say a set like “8 reps at 60” or “same again”.` : "Didn't catch that. Try again.");
        return;
      }
      const result = await onSet(set, heard);
      if ("error" in result) fail(result.error);
      else {
        setNote({ text: `Heard “${heard}”`, error: false });
        void speak(result.said);
      }
    },
    (message) => setNote({ text: message, error: true }),
  );
  const listening = talk.state === "recording";
  const busy = talk.state === "transcribing";
  return (
    <View style={{ marginTop: space.sm }}>
      <Pressable
        {...talk.pressProps}
        disabled={disabled || busy}
        accessibilityRole="button"
        accessibilityLabel={listening ? "Listening. Tap to save the set" : "Say your set"}
        accessibilityHint="Hold and say a set, like 8 reps at 60, or same again. Let go to save it."
        aria-busy={busy}
        style={({ pressed }) => [
          styles.mic,
          noSelect,
          {
            backgroundColor: listening ? t.critical : t.surface2,
            borderColor: listening ? t.critical : t.border,
            opacity: disabled ? 0.4 : pressed && !listening ? 0.8 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={t.text} />
        ) : (
          <Ionicons name={listening ? "radio-button-on" : "mic-outline"} size={20} color={listening ? t.criticalText : t.text} />
        )}
        <Txt style={{ ...typeScale.bodyStrong, color: listening ? t.criticalText : t.text }} numberOfLines={1} selectable={false}>
          {listening ? `Listening… ${talk.seconds}s` : busy ? "Writing it down…" : "Hold to say your set"}
        </Txt>
      </Pressable>
      <View accessibilityLiveRegion="polite" aria-live="polite">
        <Txt variant="tiny" style={{ marginTop: space.xs, color: note?.error ? t.critical : t.muted }}>
          {listening
            ? "Say “8 reps at 60” or “same again”, then let go (or tap again)."
            : note
              ? note.text
              : "Hands-free: “10 reps at 22.5 kilos”, “same again”. Works with headphones."}
        </Txt>
      </View>
    </View>
  );
}

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

// holding the mic mustn't select text in the browser (that cancels the press)
const noSelect = (Platform.OS === "web" ? { userSelect: "none" } : {}) as ViewStyle;

const styles = StyleSheet.create({
  mic: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  panel: { borderRadius: radius.md, padding: space.md, marginTop: space.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md },
});
