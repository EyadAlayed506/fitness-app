import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Small vibrations that confirm an action on a phone. Nothing happens in the browser,
 * and a failure (e.g. haptics turned off) is ignored.
 */
const enabled = Platform.OS !== "web";

export const haptics = {
  /** a choice changed: chips, tabs, steppers */
  selection() {
    if (enabled) Haptics.selectionAsync().catch(() => {});
  },
  /** something saved: a set, a food */
  success() {
    if (enabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** time's up: the rest timer */
  alert() {
    if (enabled) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  /** a light tap for buttons that do something big */
  impact() {
    if (enabled) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
};
