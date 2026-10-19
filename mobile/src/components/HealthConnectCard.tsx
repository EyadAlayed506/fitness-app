import { useState } from "react";
import { Linking, View } from "react-native";

import { confirm } from "@/lib/confirm";
import { timeAgo } from "@/lib/format";
import {
  connectHealthConnect,
  disconnectHealthConnect,
  openHealthConnectSettings,
  syncHealthConnect,
  type HealthConnectStatus,
} from "@/lib/healthConnect";
import { syncSummary } from "@/lib/healthConnectSessions";
import { useTheme } from "@/lib/theme";

import { Badge, Button, Card, ErrorText, LinkButton, Row, Txt } from "./ui";

const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";

/**
 * Android only: bring in sleep from Health Connect, where watches, rings and sleep apps on the phone
 * (Samsung Health, Fitbit, Garmin, Oura, Sleep as Android, bedtime mode…) save it.
 */
export function HealthConnectCard({
  status,
  onChanged,
  toast,
}: {
  status: HealthConnectStatus | null;
  onChanged: () => Promise<void>;
  toast: (msg: string) => void;
}) {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
    await onChanged();
  };

  const sync = () =>
    run(async () => {
      const r = await syncHealthConnect();
      if (r) toast(syncSummary(r));
    });

  const connect = () =>
    run(async () => {
      if (!(await connectHealthConnect())) {
        setError("The app wasn't allowed to read sleep. Tap Connect again and turn on Sleep.");
        return;
      }
      toast("Health Connect connected");
      const r = await syncHealthConnect();
      if (r) toast(syncSummary(r));
    });

  const disconnect = async () => {
    if (
      !(await confirm(
        "Stop importing from Health Connect?",
        "New sleep won't be imported on this phone any more. Sleep already imported stays in your log. To take the permission away too, use Manage in Health Connect.",
        "Stop",
      ))
    )
      return;
    await run(async () => {
      await disconnectHealthConnect();
      toast("Health Connect disconnected");
    });
  };

  if (!status || status.state === "unsupported") return null;

  if (status.connected) {
    return (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">Health Connect</Txt>
          <Badge label="Connected" tone="good" />
        </Row>
        <Txt variant="small" style={{ marginTop: 4 }}>
          Last synced {timeAgo(status.lastSyncAt)}. Sleep (and stages, when your watch or ring records them) is imported
          when you open the app.
        </Txt>
        <ErrorText message={error} />
        <Row style={{ marginTop: 12 }}>
          <Button title="Sync now" icon="sync" onPress={sync} loading={busy} style={{ flex: 1 }} />
          <Button title="Disconnect" kind="ghost" onPress={disconnect} />
        </Row>
        <Row style={{ marginTop: 12, justifyContent: "center" }}>
          <LinkButton title="Manage in Health Connect" onPress={openHealthConnectSettings} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>Connect Health Connect</Txt>
        <Txt variant="small">
          Imports sleep that your watch, ring or sleep app saves on this phone (Samsung Health, Fitbit, Garmin, Oura,
          Sleep as Android, bedtime mode…). No account needed.
        </Txt>
        {status.state === "available" ? (
          <Button title="Connect Health Connect" kind="soft" icon="fitness" onPress={connect} loading={busy} />
        ) : status.state === "needs_build" ? (
          <Txt variant="tiny" style={{ color: t.warnInk }}>
            This version of the app can&apos;t use Health Connect (Expo Go doesn&apos;t include it). Install the app&apos;s own
            build on your phone; the README explains how.
          </Txt>
        ) : (
          <>
            <Txt variant="tiny" style={{ color: t.warnInk }}>
              {status.state === "update_required"
                ? "Health Connect needs an update first."
                : "Health Connect isn't on this phone yet. It's built into Android 14 and newer; on older phones install it from Google Play."}
            </Txt>
            <Button
              title={status.state === "update_required" ? "Update Health Connect" : "Get Health Connect"}
              kind="ghost"
              icon="open-outline"
              small
              onPress={() => {
                Linking.openURL(PLAY_STORE).catch(() => {});
              }}
            />
          </>
        )}
      </View>
      <ErrorText message={error} />
    </Card>
  );
}
