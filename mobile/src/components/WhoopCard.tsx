import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { timeAgo } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { WhoopStatus, WhoopSyncResult } from "@/lib/types";

import { Badge, Button, Card, ErrorText, LinkButton, Row, Txt } from "./ui";

const POLL_MS = 3000;
const POLL_TRIES = 60; // wait up to 3 minutes for the user to finish logging in to WHOOP

export function syncSummary(r: WhoopSyncResult): string {
  if (r.skipped) return "Already up to date";
  const parts = [`${r.imported} new`, `${r.updated} updated`];
  if (r.replaced_manual) parts.push(`${r.replaced_manual} typed-in night${r.replaced_manual === 1 ? "" : "s"} replaced`);
  return `WHOOP synced: ${parts.join(", ")}`;
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
            toast("WHOOP connected");
            await onChanged();
          }
        }
      }, POLL_MS);
      await WebBrowser.openBrowserAsync(authorize_url);
    } catch (e) {
      stopPolling();
      setError((e as Error).message);
    }
  };

  const sync = async () => {
    setError(null);
    try {
      toast(syncSummary(await api<WhoopSyncResult>("/whoop/sync", { method: "POST" })));
    } catch (e) {
      setError((e as Error).message);
    }
    await onChanged();
  };

  const disconnect = async () => {
    if (!(await confirm("Disconnect WHOOP?", "New sleep won't be imported any more. Sleep already imported stays in your log.", "Disconnect"))) return;
    await api("/whoop", { method: "DELETE" });
    toast("WHOOP disconnected");
    await onChanged();
  };

  if (!status) return null;

  if (status.connected) {
    return (
      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Txt variant="h3">WHOOP</Txt>
          <Badge label="Connected" tone="good" />
        </Row>
        <Txt variant="small" style={{ marginTop: 4 }}>
          {status.whoop_name ? `${status.whoop_name} · ` : ""}last synced {timeAgo(status.last_sync_at)}. Sleep, stages and
          recovery are imported automatically.
        </Txt>
        <ErrorText message={error} />
        <Row style={{ marginTop: 12 }}>
          <Button title="Sync now" icon="sync" onPress={sync} style={{ flex: 1 }} />
          <Button title="Disconnect" kind="ghost" onPress={disconnect} />
        </Row>
        <Row style={{ marginTop: 12, justifyContent: "center" }}>
          <LinkButton title="Add a night by hand (if WHOOP missed one)" onPress={onLogManually} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      <Txt variant="h3">How do you want to track sleep?</Txt>
      <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>Log it myself</Txt>
        <Txt variant="small">Type in when you went to bed and woke up, and how you slept.</Txt>
        <Button title="Log sleep" icon="moon" onPress={onLogManually} />
      </View>
      <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: t.surface2, gap: 8 }}>
        <Txt style={{ fontWeight: "700" }}>Connect WHOOP</Txt>
        <Txt variant="small">
          If you wear a WHOOP: sleep, sleep stages and recovery are imported automatically. You log in to WHOOP once.
        </Txt>
        {status.configured ? (
          <Button
            title={waiting ? "Waiting for WHOOP login…" : "Connect WHOOP"}
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
            <LinkButton title="Cancel" onPress={stopPolling} />
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
  const steps = [
    "Log in to WHOOP's developer site with a WHOOP account (it needs a WHOOP membership).",
    "Create an app. Scopes: read:profile, read:sleep, read:recovery and offline.",
    `Add this redirect URL, exactly: ${redirectUri}`,
    "Copy the app's Client ID and Client Secret into the backend's .env file as WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET.",
    "Stop the backend and start it again. This button then turns into “Connect WHOOP”.",
  ];
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="small" style={{ color: t.warnInk }}>
        WHOOP isn&apos;t set up on this server yet. The person running the backend does this once:
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
        title="Open WHOOP developer site"
        icon="open-outline"
        kind="ghost"
        small
        onPress={() => {
          WebBrowser.openBrowserAsync("https://developer.whoop.com").catch(() => {});
        }}
      />
      <Txt variant="tiny">Until then you can log sleep by hand above.</Txt>
    </View>
  );
}
