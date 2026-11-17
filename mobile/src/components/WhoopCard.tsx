import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { timeAgo } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { errorTextFor, tr, trCount } from "@/lib/i18n/current";
import { useTheme } from "@/lib/theme";
import type { WhoopStatus, WhoopSyncResult } from "@/lib/types";

import { Badge, Button, Card, ErrorText, LinkButton, Row, Txt } from "./ui";

const POLL_MS = 3000;
const POLL_TRIES = 60; // wait up to 3 minutes for the user to finish logging in to WHOOP

export function syncSummary(r: WhoopSyncResult): string {
  if (r.skipped) return tr("whoop.upToDate");
  const parts = [tr("sync.new", { n: r.imported }), tr("sync.updated", { n: r.updated })];
  if (r.replaced_manual) parts.push(trCount("sync.replaced", r.replaced_manual));
  return tr("whoop.synced", { parts: parts.join(tr("list.separator")) });
}

/**
 * Lets the user choose how sleep gets into the app: type it in, or connect WHOOP.
 * When WHOOP is connected it shows the account, the last sync, "Sync now" and "Disconnect".
 */
export function WhoopCard({
  status,
  onChanged,
  onLogManually,
  toast,
}: {
  status: WhoopStatus | null;
  onChanged: () => Promise<void>;
  onLogManually: () => void;
  toast: (msg: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (polling.current) clearInterval(polling.current);
    polling.current = null;
    setWaiting(false);
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const connect = async () => {
    setError(null);
    try {
      const { authorize_url } = await api<{ authorize_url: string }>("/whoop/connect", { method: "POST" });
      setWaiting(true);
      // Check every few seconds whether the login finished (works for the in-app browser and a browser tab)
      let tries = 0;
      polling.current = setInterval(async () => {
        tries += 1;
        const s = await api<WhoopStatus>("/whoop").catch(() => null);
        if (s?.connected || tries >= POLL_TRIES) {
          stopPolling();
          if (s?.connected) {
            toast(tr("whoop.connected"));
            await onChanged();
          }
        }
      }, POLL_MS);
      await WebBrowser.openBrowserAsync(authorize_url);
    } catch (e) {
      stopPolling();
      setError(errorTextFor(e));
    }
  };

  const sync = async () => {
    setError(null);
    try {
      toast(syncSummary(await api<WhoopSyncResult>("/whoop/sync", { method: "POST" })));
    } catch (e) {
      setError(errorTextFor(e));
    }
    await onChanged();
  };

  const disconnect = async () => {
    if (!(await confirm(tr("whoop.disconnectTitle"), tr("whoop.disconnectText"), tr("whoop.disconnect")))) return;
    await api("/whoop", { method: "DELETE" });
    toast(tr("whoop.disconnected"));
    await onChanged();
  };

  if (!status) return null;

  if (status.connected) {
    return (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">WHOOP</Txt>
          <Badge label={tr("tracker.connected")} tone="good" />
        </Row>
        <Txt variant="small" style={{ marginTop: 4 }}>
          {status.whoop_name ? `${status.whoop_name} · ` : ""}
          {tr("whoop.lastSynced", { ago: timeAgo(status.last_sync_at) })}
        </Txt>
        <ErrorText message={error} />
        <Row style={{ marginTop: 12 }}>
          <Button title={tr("sync.now")} icon="sync" onPress={sync} style={{ flex: 1 }} />
          <Button title={tr("whoop.disconnect")} kind="ghost" onPress={disconnect} />
        </Row>
        <Row style={{ marginTop: 12, justifyContent: "center" }}>
          <LinkButton title={tr("whoop.addByHand")} onPress={onLogManually} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <Txt variant="h3">{tr("whoop.howTrack")}</Txt>
      <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>{tr("whoop.logMyself")}</Txt>
        <Txt variant="small">{tr("whoop.logMyselfText")}</Txt>
        <Button title={tr("home.logSleep")} icon="moon" onPress={onLogManually} />
      </View>
      <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>{tr("whoop.connectTitle")}</Txt>
        <Txt variant="small">
          {tr("whoop.connectText")}
        </Txt>
        {status.configured ? (
          <Button
            title={tr(waiting ? "whoop.waiting" : "whoop.connectTitle")}
            kind="soft"
            icon="link"
            onPress={connect}
            loading={waiting}
          />
        ) : (
          <WhoopSetupSteps redirectUri={status.redirect_uri} />
        )}
        {waiting ? (
          <Row style={{ justifyContent: "center" }}>
            <LinkButton title={tr("common.cancel")} onPress={stopPolling} />
          </Row>
        ) : null}
      </View>
      <ErrorText message={error} />
    </Card>
  );
}

/**
 * Shown while the server has no WHOOP app keys. WHOOP only gives keys to a registered developer app,
 * so whoever runs the backend does this once; after that every user just taps "Connect WHOOP".
 */
function WhoopSetupSteps({ redirectUri }: { redirectUri: string }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const steps = [
    tr("whoop.step1"),
    tr("whoop.step2"),
    tr("whoop.step3", { url: redirectUri }),
    tr("whoop.step4"),
    tr("whoop.step5"),
  ];
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="small" style={{ color: t.warnInk }}>
        {tr("whoop.notSetUp")}
      </Txt>
      {steps.map((step, i) => (
        <Row key={step} gap={6} style={{ alignItems: "flex-start" }}>
          <Txt variant="tiny" style={{ width: 14 }}>
            {i + 1}.
          </Txt>
          <Txt variant="tiny" style={{ flex: 1 }} selectable>
            {step}
          </Txt>
        </Row>
      ))}
      <Button
        title={tr("whoop.openDev")}
        icon="open-outline"
        kind="ghost"
        small
        onPress={() => {
          WebBrowser.openBrowserAsync("https://developer.whoop.com").catch(() => {});
        }}
      />
      <Txt variant="tiny">{tr("whoop.untilThen")}</Txt>
    </View>
  );
}
