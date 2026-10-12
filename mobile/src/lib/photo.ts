import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { api } from "./api";

export interface Photo {
  uri: string;
  type: string;
}

/**
 * A picture from the gallery (or the computer's files), or a new one from the camera.
 * Null when the user cancels. On a computer the camera choice opens the file picker too.
 */
export async function choosePhoto(source: "library" | "camera" = "library"): Promise<Photo | null> {
  if (source === "camera" && Platform.OS !== "web") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("Allow the camera in your phone's settings, or choose a photo instead.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
  const picked =
    source === "camera" && Platform.OS !== "web"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  return { uri: asset.uri, type: asset.mimeType ?? "image/jpeg" };
}

/** Send a picture to the backend (the vision model on the PC reads it). */
export function sendPhoto<T>(path: string, photo: Photo): Promise<T> {
  const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
  return api<T>(path, { method: "POST", upload: { field: "image", uri: photo.uri, name: `photo.${ext}`, type: photo.type } });
}
