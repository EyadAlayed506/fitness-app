import { Ionicons } from "@expo/vector-icons";
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

import { Button, Card, ErrorText, FadeIn, IconButton, Row, Skeleton, Txt, type IconName } from "@/components/ui";
import { useHandsFree } from "@/components/HandsFree";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { confirm } from "@/lib/confirm";
import { afterCoachActions, useAssistant } from "@/lib/data";
import { tzOffset } from "@/lib/format";
import { errorMessage, qk, queryClient, useRefreshOnFocus } from "@/lib/query";
import { useVoiceMessage } from "@/lib/voice";
import { radius, space, type as typeScale, useTheme } from "@/lib/theme";
import type { AssistantAction, AssistantStatus, ChatMessage, ChatReply } from "@/lib/types";

const STARTERS: { text: string; icon: IconName }[] = [
  { text: "What should I train today?", icon: "barbell-outline" },
  { text: "Add a banana to breakfast", icon: "restaurant-outline" },
  { text: "How did I sleep this week?", icon: "moon-outline" },
  { text: "Am I eating to my plan?", icon: "pie-chart-outline" },
];

// What each tool looked at, shown under an answer so the user knows where it came from
const TOOL_LABELS: Record<string, string> = {
  get_profile_and_plan: "profile and plan",
  get_training_plan: "training plan",
  get_today_suggestions: "today's suggestions",
  get_recent_workouts: "workouts",
  get_exercise_history: "lift history",
  get_exercise_info: "exercise library",
  get_sleep: "sleep",
  get_food_day: "food log",
  get_calorie_trend: "calories",
  get_weekly_summary: "weekly summary",
  get_points: "points",
  log_food: "food log",
  remove_food_entry: "food log",
  log_workout_sets: "workout",
  log_weight: "weigh-ins",
  log_sleep: "sleep",
};

/** Chat with the assistant about your training, sleep and food. It reads your data and can log things you ask it to. */
export default function Coach() {
  const t = useTheme();
  const { refresh } = useAuth();
  const assistant = useAssistant();
  useRefreshOnFocus([qk.assistant]);
  const status = assistant.data ?? null;
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null); // the question being answered
  const [sendError, setError] = useState<string | null>(null);
  const error = sendError ?? (status ? null : errorMessage(assistant.error));
  const handsFree = useHandsFree(); // its microphone is in use while hands-free listens
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
      setError((e as Error).message);
      setDraft(question); // keep what they typed so they can try again
    } finally {
      setPending(null);
    }
  };

  const clear = async () => {
    if (!(await confirm("Clear the conversation?", "This deletes the messages for good."))) return;
    await api("/assistant/messages", { method: "DELETE" });
    queryClient.setQueryData<AssistantStatus>(qk.assistant, (s) => (s ? { ...s, messages: [] } : s));
  };

  const messages = status?.messages ?? [];
  const canSend = !!draft.trim() && !pending;
  const recording = voice.state === "recording";
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ width: "100%", maxWidth: 600, alignSelf: "center", flex: 1 }}>
          <Row style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, justifyContent: "space-between" }} gap={space.md}>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.overline, { color: t.muted, marginBottom: 2 }]} numberOfLines={1}>
                {status ? (status.provider === "ollama" ? `ON YOUR PC · ${status.model.toUpperCase()}` : "RUNS ON CLAUDE") : " "}
              </Text>
              <Text style={[typeScale.title, { color: t.text }]} accessibilityRole="header">
                Coach
              </Text>
            </View>
            {messages.length ? <IconButton icon="trash-outline" label="Clear conversation" onPress={clear} /> : null}
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
                          Looking at your data…{status?.provider === "ollama" ? " (a model on your PC can take up to a minute)" : ""}
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
                <View style={{ gap: space.md }} accessibilityLabel="Loading the conversation">
                  <Skeleton height={44} width="70%" style={{ borderRadius: radius.lg }} />
                  <Skeleton height={44} width="55%" style={{ borderRadius: radius.lg, alignSelf: "flex-end" }} />
                  <Skeleton height={64} width="80%" style={{ borderRadius: radius.lg }} />
                </View>
              ) : null}
              {status && !status.configured ? (
                <Card>
                  <Row gap={space.sm}>
                    <Ionicons name="alert-circle" size={18} color={t.warnInk} />
                    <Txt variant="h3">The coach isn&apos;t ready yet</Txt>
                  </Row>
                  <Txt variant="small" style={{ marginTop: space.sm }} selectable>
                    {status.problem}
                  </Txt>
                  <Button title="Check again" kind="soft" small onPress={load} style={{ marginTop: space.md, alignSelf: "flex-start" }} />
                </Card>
              ) : null}
              {status?.configured ? (
                <FadeIn style={{ flex: 1, justifyContent: "center", paddingVertical: space.xl }}>
                  <View style={{ alignItems: "center", marginBottom: space.xl }}>
                    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="chatbubble-ellipses" size={24} color={t.accent} />
                    </View>
                    <Txt variant="h2" style={{ marginTop: space.md, textAlign: "center" }}>
                      How can I help today?
                    </Txt>
                    <Txt variant="small" style={{ marginTop: space.xs, textAlign: "center", maxWidth: 320 }}>
                      Ask about your training, sleep and food, or tell me what to log. I&apos;ll add it right away.
                    </Txt>
                  </View>
                  <View style={{ gap: space.sm }}>
                    {STARTERS.map((q) => (
                      <Pressable
                        key={q.text}
                        onPress={() => send(q.text)}
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
                        <Ionicons name={q.icon} size={18} color={t.text2} />
                        <Txt style={{ flex: 1 }}>{q.text}</Txt>
                        <Ionicons name="arrow-up" size={16} color={t.muted} style={{ transform: [{ rotate: "45deg" }] }} />
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
                  placeholder={recording ? "Listening…" : "Message your coach"}
                  placeholderTextColor={t.muted}
                  multiline
                  numberOfLines={1}
                  maxLength={2000}
                  accessibilityLabel="Message"
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
                  disabled={!!pending || voice.state === "transcribing" || !!handsFree?.on}
                  accessibilityRole="button"
                  accessibilityLabel={recording ? "Stop recording" : "Record a voice message"}
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
                    <Ionicons name={recording ? "stop" : "mic-outline"} size={20} color={recording ? "#fff" : t.text2} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => send(draft)}
                  disabled={!canSend}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
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
                  <Ionicons name="arrow-up" size={20} color={canSend ? t.inkText : t.muted} />
                </Pressable>
              </Row>
              {voice.state !== "idle" ? (
                <Row gap={6} style={{ marginTop: space.sm, paddingHorizontal: space.xs }}>
                  {recording ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.critical }} /> : null}
                  <Txt variant="small" style={{ color: recording ? t.critical : t.text2 }}>
                    {recording
                      ? `Recording ${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")} · tap stop when you're done`
                      : "Turning your voice into text…"}
                  </Txt>
                </Row>
              ) : null}
              <Txt variant="tiny" style={{ marginTop: space.sm, paddingHorizontal: space.xs, fontSize: 11, lineHeight: 15 }}>
                {status.disclaimer}
                {status.messages_left_today != null ? ` ${status.messages_left_today} questions left in the last 24 hours.` : ""}
              </Txt>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message: m }: { message: ChatMessage }) {
  const t = useTheme();
  const mine = m.role === "user";
  const sources = [...new Set(m.tools_used.map((x) => TOOL_LABELS[x] ?? x))];
  return (
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: mine ? "85%" : "92%" }}>
      <View
        style={{
          backgroundColor: mine ? t.ink : t.surface,
          borderColor: t.border,
          borderWidth: !mine && t.dark ? 1 : 0,
          borderRadius: 20,
          borderBottomRightRadius: mine ? 6 : 20,
          borderBottomLeftRadius: mine ? 20 : 6,
          paddingHorizontal: space.md + 2,
          paddingVertical: space.sm + 2,
        }}
      >
        <Text style={[typeScale.body, { color: mine ? t.inkText : t.text }]} selectable>
          {m.text}
        </Text>
      </View>
      {m.actions.map((a, i) => (
        <ActionCard key={`${m.id}-${i}`} action={a} />
      ))}
      {sources.length ? (
        <Txt variant="tiny" style={{ marginTop: space.xs, marginLeft: space.xs }}>
          Looked at: {sources.join(", ")}
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
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setError((e as Error).message);
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
          <Ionicons name={undone ? "arrow-undo" : ACTION_ICON[action.kind]} size={16} color={undone ? t.muted : t.goodInk} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="tiny" style={{ ...typeScale.overline, color: undone ? t.muted : t.goodInk }}>
            {undone ? "UNDONE" : action.kind === "removed" ? "REMOVED" : "ADDED"}
          </Txt>
          <Txt variant="small" style={{ color: undone ? t.muted : t.text, textDecorationLine: undone ? "line-through" : "none" }}>
            {action.summary}
          </Txt>
        </View>
      </Row>
      {undone ? null : (
        <Row gap={space.sm} style={{ marginTop: space.md }}>
          <Button title="Open" kind="soft" small icon="open-outline" onPress={() => router.push(action.screen as never)} style={{ flex: 1 }} />
          {action.undo.length ? (
            <Button title="Undo" kind="ghost" small icon="arrow-undo-outline" loading={busy} onPress={undo} style={{ flex: 1 }} />
          ) : null}
        </Row>
      )}
      <ErrorText message={error} />
    </View>
  );
}
