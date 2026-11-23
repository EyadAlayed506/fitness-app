import { useState } from "react";
import { View } from "react-native";

import { confirm } from "@/lib/confirm";
import { timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { errorTextFor } from "@/lib/i18n/current";
import {
  connectAppleHealth,
  disconnectAppleHealth,
  syncAppleHealth,
  type AppleHealthStatus,
} from "@/lib/appleHealth";
import { syncSummary } from "@/lib/healthConnectSessions";
import { useTheme } from "@/lib/theme";

import { Badge, Button, Card, ErrorText, Row, Txt } from "./ui";

/**
 * iPhone only: bring in sleep and daily steps from Apple Health (iPhone, Apple Watch, sleep apps).
 * Apple never says whether reading was allowed, so the card always explains where to check.
 */
export function AppleHealthCard({
  status,
  onChanged,
  toast,
}: {
  status: AppleHealthStatus | null;
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
      const r = await syncAppleHealth();
      if (r) toast(syncSummary(r, "ah.synced"));
    });

  const connect = () =>
    run(async () => {
      await connectAppleHealth();
      toast(tr("ah.connected"));
      const r = await syncAppleHealth();
      if (r) toast(syncSummary(r, "ah.synced"));
    });

  const disconnect = async () => {
    if (!(await confirm(tr("ah.stopTitle"), tr("ah.stopText"), tr("ah.stop")))) return;
    await run(async () => {
      await disconnectAppleHealth();
      toast(tr("ah.disconnected"));
    });
  };

  if (!status || status.state === "unsupported") return null;

  if (status.connected) {
    return (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">Apple Health</Txt>
          <Badge label={tr("tracker.connected")} tone="good" />
        </Row>
        <Txt variant="small" style={{ marginTop: 4 }}>
          {tr("ah.lastSynced", { ago: timeAgo(status.lastSyncAt) })}
        </Txt>
        <Txt variant="tiny" style={{ marginTop: 6, color: t.muted }}>
          {tr("ah.noDataHint")}
        </Txt>
        <ErrorText message={error} />
        <Row style={{ marginTop: 12 }}>
          <Button title={tr("sync.now")} icon="sync" onPress={sync} loading={busy} style={{ flex: 1 }} />
          <Button title={tr("whoop.disconnect")} kind="ghost" onPress={disconnect} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>{tr("ah.connectTitle")}</Txt>
        <Txt variant="small">{tr("ah.connectText")}</Txt>
        {status.state === "available" ? (
          <Button title={tr("ah.connectTitle")} kind="soft" icon="heart" onPress={connect} loading={busy} />
        ) : (
          <Txt variant="tiny" style={{ color: t.warnInk }}>
            {tr(status.state === "needs_build" ? "ah.needsBuild" : "ah.unavailable")}
          </Txt>
        )}
      </View>
      <ErrorText message={error} />
    </Card>
  );
}
