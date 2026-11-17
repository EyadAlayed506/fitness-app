import { useState } from "react";
import { Linking, View } from "react-native";

import { confirm } from "@/lib/confirm";
import { timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { errorTextFor } from "@/lib/i18n/current";
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
  const { t: tr } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorTextFor(e));
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
        setError(tr("hc.notAllowed"));
        return;
      }
      toast(tr("hc.connected"));
      const r = await syncHealthConnect();
      if (r) toast(syncSummary(r));
    });

  const disconnect = async () => {
    if (
      !(await confirm(tr("hc.stopTitle"), tr("hc.stopText"), tr("hc.stop")))
    )
      return;
    await run(async () => {
      await disconnectHealthConnect();
      toast(tr("hc.disconnected"));
    });
  };

  if (!status || status.state === "unsupported") return null;

  if (status.connected) {
    return (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">Health Connect</Txt>
          <Badge label={tr("tracker.connected")} tone="good" />
        </Row>
        <Txt variant="small" style={{ marginTop: 4 }}>
          {tr("hc.lastSynced", { ago: timeAgo(status.lastSyncAt) })}
        </Txt>
        <ErrorText message={error} />
        <Row style={{ marginTop: 12 }}>
          <Button title={tr("sync.now")} icon="sync" onPress={sync} loading={busy} style={{ flex: 1 }} />
          <Button title={tr("whoop.disconnect")} kind="ghost" onPress={disconnect} />
        </Row>
        <Row style={{ marginTop: 12, justifyContent: "center" }}>
          <LinkButton title={tr("hc.manage")} onPress={openHealthConnectSettings} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>{tr("hc.connectTitle")}</Txt>
        <Txt variant="small">
          {tr("hc.connectText")}
        </Txt>
        {status.state === "available" ? (
          <Button title={tr("hc.connectTitle")} kind="soft" icon="fitness" onPress={connect} loading={busy} />
        ) : status.state === "needs_build" ? (
          <Txt variant="tiny" style={{ color: t.warnInk }}>
            {tr("hc.needsBuild")}
          </Txt>
        ) : (
          <>
            <Txt variant="tiny" style={{ color: t.warnInk }}>
              {status.state === "update_required"
                ? tr("hc.updateRequired")
                : tr("hc.notInstalled")}
            </Txt>
            <Button
              title={tr(status.state === "update_required" ? "hc.update" : "hc.get")}
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
