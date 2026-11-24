import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Card, ErrorText, FadeIn, Icon, IconButton, Row, Skeleton, Txt, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { afterCoachActions, useAssistant } from "@/lib/data";
import { parseCoachText, type Span } from "@/lib/coachText";
import { tzOffset } from "@/lib/format";
import { useI18n, useLanguage, type MessageKey } from "@/lib/i18n";
import { trOr } from "@/lib/i18n/current";
import { errorMessage, qk, queryClient, useRefreshOnFocus } from "@/lib/query";
import { useVoiceMessage } from "@/lib/voice";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { AssistantAction, AssistantStatus, ChatMessage, ChatReply } from "@/lib/types";

// Sent as typed, in the app's language: the coach answers in the language it's asked in
const STARTERS: { text: MessageKey; icon: IconName }[] = [
  { text: "coach.starter1", icon: "barbell-outline" },
  { text: "coach.starter2", icon: "restaurant-outline" },
  { text: "coach.starter3", icon: "moon-outline" },
  { text: "coach.starter4", icon: "pie-chart-outline" },
];

/** Chat with the assistant about your training, sleep and food. It reads your data and can log things you ask it to. */
export default function Coach() {
  const t = useTheme();
  const { t: tr, tn, errorText } = useI18n();
  const { refresh } = useAuth();
  const assistant = useAssistant();
  useRefreshOnFocus([qk.assistant]);
  const status = assistant.data ?? null;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null); // the question being answered
  const [showNote, setShowNote] = useState(false); // the full disclaimer under the message box
  // a send error is kept as-is so it re-translates; voice errors arrive as text
  const [sendError, setError] = useState<unknown>(null);
  const error = sendError != null ? (typeof sendError === "string" ? sendError : errorText(sendError)) : status ? null : errorMessage(assistant.error);
  const voice = useVoiceMessage(
    (text) => setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)),
    (message) => setError(message),
  );

  const load = async () => {
    await assistant.refetch();
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    setPending(question);
    setDraft("");
    try {
      const r = await api<ChatReply>(`/assistant/messages?tz_offset=${tzOffset()}`, { method: "POST", body: { text: question } });
      queryClient.setQueryData<AssistantStatus>(qk.assistant, (s) =>
        s ? { ...s, messages: [...s.messages, r.question, r.answer], messages_left_today: r.messages_left_today } : s,
      );
      const kinds = r.answer.actions.map((a) => a.kind);
      afterCoachActions(kinds);
      if (kinds.includes("weight")) refresh().catch(() => {}); // the current weight is part of the profile
    } catch (e) {
      setError(e);
      setDraft(question); // keep what they typed so they can try again
    } finally {
      setPending(null);
    }
  };

  const clear = async () => {
    if (!(await confirm(tr("coach.clearTitle"), tr("coach.clearText"), tr("coach.clearConfirm")))) return;
    await api("/assistant/messages", { method: "DELETE" });
    queryClient.setQueryData<AssistantStatus>(qk.assistant, (s) => (s ? { ...s, messages: [] } : s));
  };

  const rtlText = useLanguage() === "ar" ? ({ letterSpacing: 0, textAlign: "right" } as const) : null;
  const messages = status?.messages ?? [];
  const canSend = !!draft.trim() && !pending;
  const recording = voice.state === "recording";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ width: "100%", maxWidth: 600, alignSelf: "center", flex: 1 }}>
          <Row style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, justifyContent: "space-between" }} gap={space.md}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.overline, { color: t.muted, marginBottom: 2 }, rtlText]} numberOfLines={1}>
                {status ? providerLabel(status, tr).toLocaleUpperCase() : " "}
              </Text>
              <Text style={[typeScale.title, { color: t.text }, rtlText]} accessibilityRole="header">
                {tr("nav.coach")}
              </Text>
            </View>
            {messages.length ? <IconButton icon="trash-outline" label={tr("coach.clear")} onPress={clear} /> : null}
          </Row>

          {messages.length || pending ? (
            // newest at the bottom; only the messages on screen are rendered
            <FlatList
              inverted
              style={{ flex: 1 }}
              data={[...messages].reverse()}
              keyExtractor={(m) => String(m.id)}
              renderItem={({ item }) => (
                <View style={{ paddingBottom: space.md }}>
                  <Bubble message={item} />
                </View>
              )}
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm }}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                <View style={{ gap: space.md, paddingBottom: space.md }}>
                  {pending ? (
                    <>
                      <Bubble message={{ id: -1, role: "user", text: pending, tools_used: [], actions: [], created_at: "" }} />
                      <Row
                        gap={space.sm}
                        style={{ alignSelf: "flex-start", backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm + 2 }}
                      >
                        <ActivityIndicator size="small" color={t.muted} />
                        <Txt variant="small">
                          {tr("coach.thinking")}
                          {status?.provider === "ollama" ? tr("coach.slowPc") : ""}
                        </Txt>
                      </Row>
                    </>
                  ) : null}
                  <ErrorText message={error} />
                </View>
              }
            />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: space.md, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              {!status && !error ? (
                <View style={{ gap: space.md }} accessibilityLabel={tr("coach.loading")}>
                  <Skeleton height={44} width="70%" style={{ borderRadius: radius.lg }} />
                  <Skeleton height={44} width="55%" style={{ borderRadius: radius.lg, alignSelf: "flex-end" }} />
                  <Skeleton height={64} width="80%" style={{ borderRadius: radius.lg }} />
                </View>
              ) : null}
              {status && !status.configured ? (
                <Card>
                  <Row gap={space.sm}>
                    <Icon name="alert-circle" size={18} color={t.warnInk} />
                    <Txt variant="h3">{tr("coach.notReady")}</Txt>
                  </Row>
                  <Txt variant="small" style={{ marginTop: space.sm }} selectable>
                    {status.problem}
                  </Txt>
                  <Button title={tr("coach.checkAgain")} kind="soft" small onPress={load} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
                </Card>
              ) : null}
              {status?.configured ? (
                <FadeIn style={{ flex: 1, justifyContent: "center", paddingVertical: space.xl }}>
                  <View style={{ alignItems: "center", marginBottom: space.xl }}>
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="chatbubble-ellipses" size={24} color={t.accent} />
                    </View>
                    <Txt variant="h2" style={{ marginTop: space.md, textAlign: "center" }}>
                      {tr("coach.hello")}
                    </Txt>
                    <Txt variant="small" style={{ marginTop: space.xs, textAlign: "center", maxWidth: 320 }}>
                      {tr("coach.intro")}
                    </Txt>
                  </View>
                  <View style={{ gap: space.sm }}>
                    {STARTERS.map((q) => (
                      <Pressable
                        key={q.text}
                        onPress={() => send(tr(q.text))}
                        accessibilityRole="button"
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.md,
                          minHeight: 52,
                          paddingHorizontal: space.lg,
                          borderRadius: radius.lg,
                          backgroundColor: t.surface,
                          borderWidth: t.dark ? 1 : 0,
                          borderColor: t.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Icon name={q.icon} size={18} color={t.text2} />
                        <Txt style={{ flex: 1 }}>{tr(q.text)}</Txt>
                        <Icon name="arrow-up" size={16} color={t.muted} style={{ transform: [{ rotate: rtlText ? "-45deg" : "45deg" }] }} />
                      </Pressable>
                    ))}
                  </View>
                </FadeIn>
              ) : null}
              <ErrorText message={error} />
            </ScrollView>
          )}

          {status?.configured ? (
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface, paddingHorizontal: space.md, paddingTop: space.sm + 2, paddingBottom: space.sm }}>
              <Row gap={space.sm} style={{ alignItems: "flex-end" }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={tr(recording ? "coach.listening" : "coach.placeholder")}
                  placeholderTextColor={t.muted}
                  multiline
                  numberOfLines={1}
                  maxLength={2000}
                  accessibilityLabel={tr("coach.message")}
                  onSubmitEditing={() => send(draft)}
                  onKeyPress={(e) => {
                    // keyboard on a computer: Enter sends, Shift+Enter starts a new line
                    if (Platform.OS !== "web") return;
                    const key = e.nativeEvent as unknown as { key: string; shiftKey?: boolean; isComposing?: boolean };
                    if (key.key === "Enter" && !key.shiftKey && !key.isComposing) {
                      e.preventDefault();
                      send(draft);
                    }
                  }}
                  style={[
                    typeScale.body,
                    {
                      flex: 1,
                      minHeight: 44,
                      maxHeight: 120,
                      borderRadius: 22,
                      paddingHorizontal: space.lg,
                      paddingTop: 11,
                      paddingBottom: 11,
                      color: t.text,
                      backgroundColor: t.surface2,
                      outlineWidth: 0,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => {
                    setError(null);
                    voice.toggle();
                  }}
                  disabled={!!pending || voice.state === "transcribing"}
                  accessibilityRole="button"
                  accessibilityLabel={tr(recording ? "coach.stopRecording" : "coach.record")}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: recording ? t.critical : t.surface2,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  {voice.state === "transcribing" ? (
                    <ActivityIndicator size="small" color={t.text2} />
                  ) : (
                    <Icon name={recording ? "stop" : "mic-outline"} size={20} color={recording ? "#fff" : t.text2} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => send(draft)}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel={tr("coach.send")}
                  aria-disabled={!canSend}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: canSend ? t.ink : t.surface2,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Icon name="arrow-up" size={20} color={canSend ? t.inkText : t.muted} />
                </Pressable>
              </Row>
              {voice.state !== "idle" ? (
                <Row gap={6} style={{ marginTop: space.sm, paddingHorizontal: space.xs }}>
                  {recording ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.critical }} /> : null}
                  <Txt variant="small" style={{ color: recording ? t.critical : t.text2 }}>
                    {recording
                      ? tr("coach.recording", { time: `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}` })
                      : tr("coach.transcribing")}
                  </Txt>
                </Row>
              ) : null}
              <Pressable
                onPress={() => setShowNote((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showNote }}
                accessibilityLabel={tr(showNote ? "coach.noteLess" : "coach.noteMore")}
                style={{ marginTop: space.sm, paddingHorizontal: space.xs }}
              >
                <Row gap={space.xs} style={{ alignItems: "flex-start" }}>
                  <Txt variant="tiny" style={{ flex: 1, fontSize: 11, lineHeight: 15 }} numberOfLines={showNote ? undefined : 1}>
                    {status.messages_left_today != null ? `${tn("coach.questionsLeft", status.messages_left_today)} ` : ""}
                    {showNote ? status.disclaimer : tr("coach.noteShort")}
                  </Txt>
                  <Txt variant="tiny" style={{ fontSize: 11, lineHeight: 15, color: t.accent }}>
                    {tr(showNote ? "coach.noteLess" : "coach.noteMore")}
                  </Txt>
                </Row>
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The line above the title: which AI answers. */
function providerLabel(status: AssistantStatus, tr: (key: MessageKey, values?: Record<string, string | number>) => string) {
  if (status.provider === "ollama") return tr("coach.onPc", { model: status.model });
  return tr(status.provider === "gemini" ? "coach.onGemini" : "coach.onClaude");
}

function Bubble({ message: m }: { message: ChatMessage }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const align = useTextAlign();
  const mine = m.role === "user";
  const sources = [...new Set(m.tools_used.map((x) => trOr(`tool.${x}`, x)))];
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: mine ? "85%" : "92%" }}>
      <View
        style={{
          backgroundColor: mine ? t.ink : t.surface,
          borderColor: t.border,
          borderWidth: !mine && t.dark ? 1 : 0,
          borderRadius: 20,
          borderBottomEndRadius: mine ? 6 : 20,
          borderBottomStartRadius: mine ? 20 : 6,
          paddingHorizontal: space.md + 2,
          paddingVertical: space.sm + 2,
        }}
      >
        {mine ? (
          <Text style={[typeScale.body, { color: t.inkText }, align]} selectable>
            {m.text}
          </Text>
        ) : (
          <CoachText text={m.text} />
        )}
      </View>
      {m.actions.map((a, i) => (
        <ActionCard key={`${m.id}-${i}`} action={a} />
      ))}
      {sources.length ? (
        <Txt variant="tiny" style={{ marginTop: space.xs, marginStart: space.xs }}>
          {tr("coach.lookedAt", { sources: sources.join(tr("list.separator")) })}
        </Txt>
      ) : null}
    </View>
  );
}

const ACTION_ICON: Record<AssistantAction["kind"], IconName> = {
  food: "restaurant",
  sets: "barbell",
  weight: "scale",
  sleep: "moon",
  removed: "trash",
};

/** Something the coach added: where to see it, and an Undo. */
function ActionCard({ action }: { action: AssistantAction }) {
  const t = useTheme();
  const { t: tr, errorText } = useI18n();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const path of action.undo) {
        await api(path, { method: "DELETE" }).catch((e) => {
          if ((e as { status?: number }).status !== 404) throw e; // already gone is fine
        });
      }
      setUndone(true);
      afterCoachActions([action.kind === "removed" ? "removed" : action.kind]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        marginTop: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.surface,
        padding: space.md,
      }}
    >
      <Row gap={space.md} style={{ alignItems: "flex-start" }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm + 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: undone ? t.surface2 : t.goodSoft,
          }}
        >
          <Icon name={undone ? "arrow-undo" : ACTION_ICON[action.kind]} size={16} color={undone ? t.muted : t.goodInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="tiny" style={{ ...typeScale.overline, color: undone ? t.muted : t.goodInk }}>
            {tr(undone ? "coach.undone" : action.kind === "removed" ? "coach.removed" : "coach.added").toLocaleUpperCase()}
          </Txt>
          <Txt variant="small" style={{ color: undone ? t.muted : t.text, textDecorationLine: undone ? "line-through" : "none" }}>
            {action.summary}
          </Txt>
        </View>
      </Row>
      {undone ? null : (
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button title={tr("coach.open")} kind="soft" small icon="open-outline" onPress={() => router.push(action.screen as never)} style={{ flex: 1 }} />
          {action.undo.length ? (
            <Button title={tr("common.undo")} kind="ghost" small icon="arrow-undo-outline" loading={busy} onPress={undo} style={{ flex: 1 }} />
          ) : null}
        </Row>
      )}
      <ErrorText message={error == null ? null : errorText(error)} />
    </View>
  );
}

/** A coach reply: block titles, list items with a hanging indent, bold key numbers. */
function CoachText({ text }: { text: string }) {
  const t = useTheme();
  const align = useTextAlign();
  const draw = (parts: Span[]) =>
    parts.map((s, i) => (
      <Text key={i} style={s.bold ? { fontWeight: "700", color: t.text } : undefined}>
        {s.text}
      </Text>
    ));
  return (
    <View>
      {parseCoachText(text).map((line, i) =>
        line.kind === "gap" ? (
          <View key={i} style={{ height: space.sm }} />
        ) : line.kind === "bullet" ? (
          <View key={i} style={{ flexDirection: "row", gap: space.sm, marginTop: 3 }}>
            <Text style={[typeScale.body, { color: t.accent }]}>•</Text>
            <Text style={[typeScale.body, { color: t.text, flex: 1 }, align]} selectable>
              {draw(line.spans)}
            </Text>
          </View>
        ) : (
          <Text key={i} style={[line.kind === "title" ? typeScale.bodyStrong : typeScale.body, { color: t.text }, align]} selectable>
            {draw(line.spans)}
          </Text>
        ),
      )}
    </View>
  );
}

/** Text that lines up with the page: right in Arabic, left in English, whatever script the text is in. */
function useTextAlign() {
  return { textAlign: useLanguage() === "ar" ? "right" : "left" } as const;
}
