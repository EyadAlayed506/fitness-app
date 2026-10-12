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
/** questions asked before the app's dialog was ready: shown as soon as it is */
const waiting: { request: ConfirmRequest; resolve: (ok: boolean) => void }[] = [];
const WAIT_MS = 1500;

/** The app's own dialog registers here (see DialogProvider in components/ui.tsx). */
export function setConfirmHandler(h: Handler | null) {
  handler = h;
  if (h) for (const w of waiting.splice(0)) h(w.request).then(w.resolve);
}

/**
 * Yes/no question in the app's own dialog. If the dialog isn't ready yet (the app is still starting), the
 * question waits for it; only if it never appears does the system's own box ask instead.
 */
export function confirm(title: string, message: string, okLabel = "OK", destructive = true): Promise<boolean> {
  const request = { title, message, okLabel, destructive };
  if (handler) return handler(request);
  return new Promise((resolve) => {
    const item = { request, resolve };
    waiting.push(item);
    setTimeout(() => {
      const i = waiting.indexOf(item);
      if (i < 0) return; // the app's dialog took it
      waiting.splice(i, 1);
      systemConfirm(request).then(resolve);
    }, WAIT_MS);
  });
}

function systemConfirm({ title, message, okLabel, destructive }: ConfirmRequest): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ]),
  );
}
