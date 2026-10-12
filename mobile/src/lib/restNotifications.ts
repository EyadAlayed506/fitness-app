import { Platform } from "react-native";

/**
 * A local notification for the end of a rest, so the phone tells you even when the app is in the
 * background or the screen is locked. While the app is open the in-app alert is used instead.
 *
 * expo-notifications is loaded the first time a rest starts (not at launch), and permission is asked
 * then too. Browsers don't get one (the page beeps instead).
 */
type Notifications = typeof import("expo-notifications");

const CHANNEL = "rest-timer";
let loading: Promise<Notifications | null> | null = null;

function load(): Promise<Notifications | null> {
  if (Platform.OS === "web") return Promise.resolve(null);
  loading ??= import("expo-notifications")
    .then(async (N) => {
      // In the foreground the app shows its own alert, so don't show a banner as well
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: false,
          shouldShowList: false,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
      if (Platform.OS === "android") {
        await N.setNotificationChannelAsync(CHANNEL, {
          name: "Rest timer",
          importance: N.AndroidImportance.HIGH,
          vibrationPattern: [0, 400, 200, 400],
          sound: "default",
        });
      }
      return N;
    })
    .catch(() => null);
  return loading;
}

/**
 * Schedule "Rest is over" in `seconds`. `next` is the next set when it's known (hands-free sets), e.g.
 * "Next: set 3 of 4, 8 reps at 60 kilos." Returns its id, or null (no permission, or not supported).
 */
export async function scheduleRestEnd(seconds: number, exerciseName: string, next: string | null = null): Promise<string | null> {
  const N = await load();
  if (!N || seconds < 1) return null;
  try {
    const current = await N.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) granted = (await N.requestPermissionsAsync()).granted;
    if (!granted) return null;
    return await N.scheduleNotificationAsync({
      content: {
        title: "Rest is over",
        body: next ?? (exerciseName ? `Time for your next set of ${exerciseName}` : "Time for your next set"),
        sound: "default",
      },
      trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.round(seconds), channelId: CHANNEL },
    });
  } catch {
    return null;
  }
}

/** Cancel a scheduled rest notification, and clear it if it was already shown. */
export async function cancelRestEnd(id: string | null): Promise<void> {
  if (!id) return;
  const N = await load();
  if (!N) return;
  await N.cancelScheduledNotificationAsync(id).catch(() => {});
  await N.dismissNotificationAsync(id).catch(() => {});
}
