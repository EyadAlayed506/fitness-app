import { Alert, Platform } from "react-native";

export interface ConfirmRequest {
  title: string;
  message: string;
  okLabel: string;
  /** the OK button deletes or discards something (shown in red) */
  destructive: boolean;
}

type Handler = (request: ConfirmRequest) => Promise<boolean>;
let handler: Handler | null = null;

/** The app's own dialog registers here (see DialogProvider in components/ui.tsx). */
export function setConfirmHandler(h: Handler | null) {
  handler = h;
}

/** Yes/no question in the app's own dialog (falls back to the system one before the app has loaded). */
export function confirm(title: string, message: string, okLabel = "OK", destructive = true): Promise<boolean> {
  if (handler) return handler({ title, message, okLabel, destructive });
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]),
  );
}
