import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";

import { api } from "@/lib/api";
import { cap } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { Exercise } from "@/lib/types";

import { Badge, Button, ErrorText, LinkButton, Row, Txt } from "./ui";
import type { PickedExercise } from "./WorkoutParts";

interface Recognition {
  guesses: { exercise: Exercise; confidence: number }[];
  seen: string;
  model: string;
}

const likelihood = (c: number) =>
  c >= 0.7 ? { label: "Very likely", tone: "good" as const } : c >= 0.4 ? { label: "Likely", tone: "info" as const } : { label: "Maybe", tone: "neutral" as const };

/**
 * Choose or take a photo of a machine; the vision model on the PC suggests up to three exercises from the app's
 * library. The user always picks the right one (or searches by name). The photo isn't saved.
 */
export function ExercisePhoto({ onPick, onSearch }: { onPick: (e: PickedExercise) => void; onSearch: () => void }) {
  const t = useTheme();
  const [usingCamera, setUsingCamera] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<Recognition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhoto(null);
    setResult(null);
    setError(null);
  };

  const recognize = async (uri: string, type = "image/jpeg") => {
    setError(null);
    setPhoto(uri);
    try {
      const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      setResult(
        await api<Recognition>("/exercises/recognize", {
          method: "POST",
          upload: { field: "image", uri, name: `photo.${ext}`, type },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // a picture from the computer's files or the phone's gallery: no camera needed
  const choose = async () => {
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
          Choose or take a photo of the machine. Fit the whole machine in, and its name sticker if it has one.
        </Txt>
        <Button title="Choose a photo" icon="image-outline" onPress={() => choose().catch((e) => setError((e as Error).message))} />
        <Button title="Use the camera" icon="camera-outline" kind="soft" onPress={() => setUsingCamera(true)} />
        <ErrorText message={error} />
        <LinkButton title="Search by name instead" onPress={onSearch} />
      </View>
    );
  }

  return (
    <View>
      <Row gap={12} style={{ alignItems: "flex-start" }}>
        <Image source={{ uri: photo }} style={{ width: 88, height: 88, borderRadius: 10, backgroundColor: t.surface2 }} accessibilityLabel="Your photo" />
        <View style={{ flex: 1 }}>
          {result ? (
            <>
              <Txt style={{ fontWeight: "700" }}>{result.guesses.length ? "Which one is it?" : "No match in the library"}</Txt>
              {result.seen ? <Txt variant="tiny" style={{ marginTop: 2 }}>The AI saw: {result.seen}</Txt> : null}
            </>
          ) : error ? null : (
            <Row gap={8}>
              <ActivityIndicator size="small" color={t.accent} />
              <Txt variant="small" style={{ flex: 1 }}>
                Looking at the photo… (the model on your PC can take up to a minute)
              </Txt>
            </Row>
          )}
        </View>
      </Row>
      <ErrorText message={error} />

      {result?.guesses.map(({ exercise, confidence }) => {
        const l = likelihood(confidence);
        return (
          <Pressable
            key={exercise.id}
            onPress={() => onPick({ id: exercise.id, name: exercise.name })}
            accessibilityRole="button"
            accessibilityLabel={`${exercise.name}, ${l.label}`}
            style={{ marginTop: 10, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 12, backgroundColor: t.surface }}
          >
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={{ fontWeight: "700", flex: 1 }}>{exercise.name}</Txt>
              <Badge label={l.label} tone={l.tone} />
            </Row>
            <Txt variant="tiny">
              {cap(exercise.muscle_group)} · {exercise.category}
            </Txt>
          </Pressable>
        );
      })}

      {result || error ? (
        <Row style={{ marginTop: 14, justifyContent: "space-between" }}>
          <LinkButton title="Try another photo" onPress={reset} />
          <LinkButton title="None of these: search" onPress={onSearch} />
        </Row>
      ) : null}
      <Txt variant="tiny" style={{ marginTop: 10 }}>
        Guesses come from an AI on your PC and can be wrong: tap the right one. The photo isn&apos;t saved.
      </Txt>
    </View>
  );
}

/** Live camera with a shutter button (phones, or a computer with a webcam). */
function CameraCapture({ onPhoto, onCancel }: { onPhoto: (uri: string) => void; onCancel: () => void }) {
  const t = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shoot = async () => {
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.6 });
      if (picture?.uri) onPhoto(picture.uri);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={{ padding: 16, borderRadius: 12, backgroundColor: t.surface2, gap: 10 }}>
        <Txt variant="small">
          {permission && !permission.canAskAgain
            ? "Camera access is turned off for this app. Allow it in your settings, or choose a photo instead."
            : "Allow the camera to take a photo of the machine."}
        </Txt>
        {!permission || permission.canAskAgain ? <Button title="Allow camera" icon="camera" onPress={async () => { await requestPermission(); }} /> : null}
        <LinkButton title="Choose a photo instead" onPress={onCancel} />
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
          onMountError={() => setError("No camera found. Choose a photo instead.")}
        />
      </View>
      <Button title="Take photo" icon="camera" onPress={shoot} disabled={!ready} style={{ marginTop: 10 }} />
      <ErrorText message={error} />
      <View style={{ marginTop: 8 }}>
        <LinkButton title="Choose a photo instead" onPress={onCancel} />
      </View>
    </View>
  );
}
