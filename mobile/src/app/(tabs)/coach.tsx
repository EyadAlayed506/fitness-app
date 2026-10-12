import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card, ErrorText, IconButton, LinkButton, Row, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { confirm } from "@/lib/confirm";
import { tzOffset } from "@/lib/format";
import { useVoiceMessage } from "@/lib/voice";
import { useTheme } from "@/lib/theme";
import type { AssistantAction, AssistantStatus, ChatMessage, ChatReply } from "@/lib/types";

const STARTERS = [
  "What should I train today?",
  "Add a banana to breakfast",
  "How did I sleep this week?",
  "Am I eating to my plan?",
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

/** Chat with the assistant about your training, sleep and food. It reads your data; it can't change it. */
export default function Coach() {
  const t = useTheme();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null); // the question being answered
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const voice = useVoiceMessage(
    (text) => setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)),
    (message) => setError(message),
  );

  const load = useCallback(async () => {
    setStatus(await api<AssistantStatus>("/assistant"));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load().catch((e) => setError((e as Error).message));
    }, [load]),
  );

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setError(null);
    setPending(question);
    setDraft("");
    try {
      const r = await api<ChatReply>(`/assistant/messages?tz_offset=${tzOffset()}`, { method: "POST", body: { text: question } });
      setStatus((s) => (s ? { ...s, messages: [...s.messages, r.question, r.answer], messages_left_today: r.messages_left_today } : s));
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
    await load();
  };

  const messages = status?.messages ?? [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center", flex: 1 }}>
          <Row style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.5, color: t.text }} accessibilityRole="header">
                Coach
              </Text>
              <Txt variant="tiny">
                Ask about your training, sleep and food, or tell it what to log.
                {status ? (status.provider === "ollama" ? ` Runs on your PC (${status.model}).` : " Runs on Claude.") : ""}
              </Txt>
            </View>
            {messages.length ? <IconButton icon="trash-outline" label="Clear conversation" onPress={clear} /> : null}
          </Row>

          <ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          >
            {status && !status.configured ? (
              <Card>
                <Txt variant="h3">The coach isn&apos;t ready yet</Txt>
                <Txt variant="small" style={{ marginTop: 6 }} selectable>
                  {status.problem}
                </Txt>
                <View style={{ marginTop: 10 }}>
                  <LinkButton title="Check again" onPress={() => load().catch((e) => setError((e as Error).message))} />
                </View>
              </Card>
            ) : null}
            {status?.configured && !messages.length && !pending ? (
              <View style={{ gap: 8 }}>
                <Txt variant="small">Try one of these:</Txt>
                {STARTERS.map((q) => (
                  <Pressable
                    key={q}
                    onPress={() => send(q)}
                    accessibilityRole="button"
                    style={{ borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, borderRadius: 12, padding: 12 }}
                  >
                    <Txt>{q}</Txt>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {messages.map((m) => (
              <Bubble key={m.id} message={m} />
            ))}
            {pending ? (
              <>
                <Bubble message={{ id: -1, role: "user", text: pending, tools_used: [], actions: [], created_at: "" }} />
                <Row gap={8} style={{ paddingHorizontal: 4 }}>
                  <ActivityIndicator size="small" color={t.accent} />
                  <Txt variant="small">
                    Looking at your data…{status?.provider === "ollama" ? " (a model on your PC can take up to a minute)" : ""}
                  </Txt>
                </Row>
              </>
            ) : null}
            <ErrorText message={error} />
          </ScrollView>

          {status?.configured ? (
            <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.surface, padding: 10 }}>
              <Row gap={8} style={{ alignItems: "flex-end" }}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Ask your coach…"
                  placeholderTextColor={t.muted}
                  multiline
                  maxLength={2000}
                  accessibilityLabel="Message"
                  onSubmitEditing={() => send(draft)}
                  style={{
                    flex: 1,
                    minHeight: 42,
                    maxHeight: 120,
                    borderWidth: 1,
                    borderColor: t.border,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    color: t.text,
                    backgroundColor: t.bg,
                    fontSize: 15,
                  }}
                />
                <Pressable
                  onPress={() => {
                    setError(null);
                    voice.toggle();
                  }}
                  disabled={!!pending || voice.state === "transcribing"}
                  accessibilityRole="button"
                  accessibilityLabel={voice.state === "recording" ? "Stop recording" : "Record a voice message"}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: voice.state === "recording" ? t.critical : t.surface2,
                  }}
                >
                  {voice.state === "transcribing" ? (
                    <ActivityIndicator size="small" color={t.accent} />
                  ) : (
                    <Ionicons name={voice.state === "recording" ? "stop" : "mic-outline"} size={20} color={voice.state === "recording" ? "#fff" : t.text2} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => send(draft)}
                  disabled={!draft.trim() || !!pending}
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: draft.trim() && !pending ? t.accent : t.surface2,
                  }}
                >
                  <Ionicons name="arrow-up" size={20} color={draft.trim() && !pending ? t.accentInk : t.muted} />
                </Pressable>
              </Row>
              {voice.state !== "idle" ? (
                <Txt variant="small" style={{ marginTop: 6, color: voice.state === "recording" ? t.critical : t.text2 }}>
                  {voice.state === "recording"
                    ? `Recording… ${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}  Tap ■ to stop.`
                    : "Turning your voice into text…"}
                </Txt>
              ) : null}
              <Txt variant="tiny" style={{ marginTop: 6 }}>
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
    <View style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%" }}>
      <View
        style={{
          backgroundColor: mine ? t.accent : t.surface,
          borderColor: t.border,
          borderWidth: mine ? 0 : 1,
          borderRadius: 14,
          paddingHorizontal: 12,
          paddingVertical: 9,
        }}
      >
        <Text style={{ color: mine ? t.accentInk : t.text, fontSize: 15, lineHeight: 21 }} selectable>
          {m.text}
        </Text>
      </View>
      {m.actions.map((a, i) => (
        <ActionCard key={`${m.id}-${i}`} action={a} />
      ))}
      {sources.length ? (
        <Txt variant="tiny" style={{ marginTop: 3, marginLeft: 4 }}>
          Looked at: {sources.join(", ")}
        </Txt>
      ) : null}
    </View>
  );
}

const ACTION_ICON: Record<AssistantAction["kind"], keyof typeof Ionicons.glyphMap> = {
  food: "restaurant-outline",
  sets: "barbell-outline",
  weight: "scale-outline",
  sleep: "moon-outline",
  removed: "trash-outline",
};

/** Something the coach added: where to see it, and an Undo. */
function ActionCard({ action }: { action: AssistantAction }) {
  const t = useTheme();
  const [undone, setUndone] = useState(false);
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    setBusy(true);
    try {
      for (const path of action.undo) {
        await api(path, { method: "DELETE" }).catch((e) => {
          if ((e as { status?: number }).status !== 404) throw e; // already gone is fine
        });
      }
      setUndone(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={{
        marginTop: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: undone ? t.surface2 : t.accentSoft,
        padding: 10,
        gap: 6,
      }}
    >
      <Row gap={8} style={{ alignItems: "flex-start" }}>
        <Ionicons name={undone ? "arrow-undo-outline" : ACTION_ICON[action.kind]} size={18} color={undone ? t.muted : t.accent} />
        <Txt variant="small" style={{ flex: 1, color: undone ? t.muted : t.text, textDecorationLine: undone ? "line-through" : "none" }}>
          {action.kind === "removed" ? "" : "Added: "}
          {action.summary}
        </Txt>
      </Row>
      {undone ? (
        <Txt variant="tiny">Undone</Txt>
      ) : (
        <Row gap={14}>
          <LinkButton title="Open" onPress={() => router.push(action.screen as never)} />
          {action.undo.length ? <LinkButton title={busy ? "Undoing…" : "Undo"} onPress={undo} /> : null}
        </Row>
      )}
    </View>
  );
}
