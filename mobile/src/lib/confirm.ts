import { Alert, Platform } from "react-native";

/** Yes/no question that works on phones and in the browser. */
export function confirm(title: string, message: string, okLabel = "OK"): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: okLabel, style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}
