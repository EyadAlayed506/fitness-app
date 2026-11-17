import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";

import { api } from "@/lib/api";
import { idLabel, shortDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { errorTextFor } from "@/lib/i18n/current";
import { invalidate, qk } from "@/lib/query";
import { space, type as typeScale, useTheme } from "@/lib/theme";
import type { SmartRecognition } from "@/lib/types";

import { PhotoMatchStatusCard } from "./GymParts";
import { Badge, Button, ErrorText, Icon, LinkButton, Row, Txt } from "./ui";
import { ExerciseSearch, type PickedExercise } from "./WorkoutParts";

const likelihood = (c: number) =>
  c >= 0.7
    ? { label: "photo.veryLikely" as const, tone: "good" as const }
    : c >= 0.4
      ? { label: "photo.likely" as const, tone: "info" as const }
      : { label: "photo.maybe" as const, tone: "neutral" as const };

/**
 * Choose or take a photo of a machine. Earlier photos the user confirmed are checked first ("Matched from
 * your earlier photo"); otherwise the machine classifier on the PC suggests exercises ("Best guess"). Whatever the
 * user picks is remembered with the photo, so the app gets better at their gym's machines.
 */
export function ExercisePhoto({
  onPick,
  onSearch,
  gymId,
}: {
  onPick: (e: PickedExercise) => void;
  onSearch: () => void;
  /** the gym the photo is taken at (the workout's gym) */
  gymId?: number | null;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [usingCamera, setUsingCamera] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<SmartRecognition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const reset = () => {
    setPhoto(null);
    setResult(null);
    setError(null);
    setSearching(false);
  };

  const recognize = async (uri: string, type = "image/jpeg") => {
    setError(null);
    setPhoto(uri);
    try {
      const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const r = await api<SmartRecognition>(`/photo-memory/recognize${gymId ? `?gym_id=${gymId}` : ""}`, {
        method: "POST",
        upload: { field: "image", uri, name: `photo.${ext}`, type },
      });
      setResult(r);
      if (r.source === "none") setSearching(true); // nothing recognised: pick it by hand
    } catch (e) {
      setError(errorTextFor(e));
    }
  };

  /** The user's answer: remember the photo as this machine (in the background), then log it. */
  const choose = (e: PickedExercise) => {
    if (result) {
      const first = result.guesses[0]?.exercise.id;
      api("/photo-memory/photos", {
        method: "POST",
        body: { photo_token: result.photo_token, exercise_id: e.id, gym_id: gymId ?? null, corrected: first != null && first !== e.id },
      })
        .then(() => invalidate(qk.machinePhotos, qk.gyms))
        .catch(() => {}); // logging the set matters more than remembering the photo
    }
    onPick(e);
  };

  // a picture from the computer's files or the phone's gallery: no camera needed
  const pickFile = async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    await recognize(asset.uri, asset.mimeType ?? "image/jpeg");
  };

  if (!photo && usingCamera) {
    return <CameraCapture onPhoto={(uri) => recognize(uri)} onCancel={() => setUsingCamera(false)} />;
  }

  if (!photo) {
    return (
      <View style={{ gap: 10 }}>
        <Txt variant="small">
          {tr("photo.intro")}
        </Txt>
        <Button title={tr("photo.choose")} icon="image-outline" onPress={() => pickFile().catch((e) => setError(errorTextFor(e)))} />
        <Button title={tr("photo.camera")} icon="camera-outline" kind="soft" onPress={() => setUsingCamera(true)} />
        <ErrorText message={error} />
        <LinkButton title={tr("photo.searchInstead")} onPress={onSearch} />
        <PhotoMatchStatusCard compact />
      </View>
    );
  }

  const fromMemory = result?.source === "memory";
  return (
    <View>
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <Image source={{ uri: photo }} style={{ width: 88, height: 88, borderRadius: 10, backgroundColor: t.surface2 }} accessibilityLabel={tr("photo.yourPhoto")} />
        <View style={{ flex: 1 }}>
          {result ? (
            <>
              {fromMemory && result.match ? (
                <View style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.goodSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Icon name="sparkles" size={14} color={t.goodInk} />
                  <Txt variant="label" style={{ color: t.goodInk }}>
                    {tr("photo.matched")}
                  </Txt>
                </View>
              ) : (
                <Txt variant="tiny" style={{ ...typeScale.overline, color: t.muted }}>
                  {tr(result.source === "model" ? "photo.bestGuess" : "photo.notRecognised").toLocaleUpperCase()}
                </Txt>
              )}
              <Txt style={{ fontWeight: "700", marginTop: 4 }}>
                {tr(fromMemory ? "photo.isItThis" : result.guesses.length ? "photo.whichOne" : "photo.pick")}
              </Txt>
              {fromMemory && result.match ? (
                <Txt variant="tiny" style={{ marginTop: 2 }}>
                  {tr("photo.likeEarlier", { percent: Math.round(result.match.similarity * 100), date: shortDate(result.match.taken_at.slice(0, 10)) })}
                </Txt>
              ) : result.seen ? (
                <Txt variant="tiny" style={{ marginTop: 2 }}>
                  {tr("menu.seen", { seen: result.seen })}
                </Txt>
              ) : null}
            </>
          ) : error ? null : (
            <Row gap={8}>
              <ActivityIndicator size="small" color={t.accent} />
              <Txt variant="small" style={{ flex: 1 }}>
                {tr("photo.checking")}
              </Txt>
            </Row>
          )}
        </View>
      </Row>
      <ErrorText message={error} />
      {result?.problem ? (
        <Txt variant="small" style={{ marginTop: space.sm, color: t.warnInk }}>
          {tr("photo.pickBelow", { problem: result.problem })}
        </Txt>
      ) : null}

      {!searching
        ? result?.guesses.map(({ exercise, confidence }) => {
            const l = fromMemory
              ? { label: tr("photo.percentMatch", { percent: Math.round(confidence * 100) }), tone: "good" as const }
              : { label: tr(likelihood(confidence).label), tone: likelihood(confidence).tone };
            return (
              <Pressable
                key={exercise.id}
                onPress={() => choose({ id: exercise.id, name: exercise.name })}
                accessibilityRole="button"
                accessibilityLabel={tr("photo.optionLabel", { name: exercise.name, likelihood: l.label })}
                style={({ pressed }) => ({
                  marginTop: 10,
                  borderWidth: 1,
                  borderColor: fromMemory ? t.good : t.border,
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: t.surface,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt style={{ fontWeight: "700", flex: 1 }}>{exercise.name}</Txt>
                  <Badge label={l.label} tone={l.tone} />
                </Row>
                <Txt variant="tiny">
                  {idLabel("muscle", exercise.muscle_group)} · {idLabel("category", exercise.category)}
                </Txt>
              </Pressable>
            );
          })
        : null}

      {searching ? (
        <View style={{ marginTop: space.md }}>
          <ExerciseSearch onPick={choose} />
        </View>
      ) : null}

      {result || error ? (
        <Row style={{ marginTop: 14, justifyContent: "space-between", flexWrap: "wrap" }} gap={space.sm}>
          <LinkButton title={tr("photo.another")} onPress={reset} />
          {result && !searching ? <LinkButton title={tr(fromMemory ? "photo.somethingElse" : "photo.noneSearch")} onPress={() => setSearching(true)} /> : null}
          {!result ? <LinkButton title={tr("photo.searchByName")} onPress={onSearch} /> : null}
        </Row>
      ) : null}
      <Txt variant="tiny" style={{ marginTop: 10 }}>
        {tr("photo.guessesNote")}
      </Txt>
    </View>
  );
}

/** Live camera with a shutter button (phones, or a computer with a webcam). */
function CameraCapture({ onPhoto, onCancel }: { onPhoto: (uri: string) => void; onCancel: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shoot = async () => {
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.6 });
      if (picture?.uri) onPhoto(picture.uri);
    } catch (e) {
      setError(errorTextFor(e));
    }
  };

  if (!permission?.granted) {
    return (
      <View style={{ padding: 16, borderRadius: 12, backgroundColor: t.surface2, gap: 10 }}>
        <Txt variant="small">
          {permission && !permission.canAskAgain
            ? tr("photo.cameraOff")
            : tr("photo.allowHint")}
        </Txt>
        {!permission || permission.canAskAgain ? <Button title={tr("qr.allow")} icon="camera" onPress={async () => { await requestPermission(); }} /> : null}
        <LinkButton title={tr("photo.chooseInstead")} onPress={onCancel} />
      </View>
    );
  }

  return (
    <View>
      <View style={{ height: 320, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" }}>
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing="back"
          onCameraReady={() => setReady(true)}
          onMountError={() => setError(tr("photo.noCamera"))}
        />
      </View>
      <Button title={tr("photo.take")} icon="camera" onPress={shoot} disabled={!ready} style={{ marginTop: 10 }} />
      <ErrorText message={error} />
      <View style={{ marginTop: 8 }}>
        <LinkButton title={tr("photo.chooseInstead")} onPress={onCancel} />
      </View>
    </View>
  );
}
