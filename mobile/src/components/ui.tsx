import { Ionicons } from "@expo/vector-icons";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/lib/theme";

// ---------- layout ----------

export function Screen({
  title,
  subtitle,
  right,
  children,
  onRefresh,
  refreshing = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        <View style={[styles.row, { justifyContent: "space-between", marginBottom: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.h1, { color: t.text }]} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={{ color: t.muted, fontSize: 13 }}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={[styles.row, { justifyContent: "space-between", marginBottom: 8 }]}>
      <Txt variant="h3" style={{ flex: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

export function Section({ title }: { title: string }) {
  return (
    <Txt variant="h2" style={{ marginTop: 18, marginBottom: 10 }}>
      {title}
    </Txt>
  );
}

export function Row({ children, style, gap = 8 }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

// ---------- text ----------

type Variant = "body" | "small" | "tiny" | "muted" | "h2" | "h3" | "big" | "hero" | "label";

export function Txt({
  children,
  variant = "body",
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  const v: Record<Variant, TextStyle> = {
    body: { fontSize: 15, color: t.text },
    small: { fontSize: 13, color: t.text2 },
    tiny: { fontSize: 12, color: t.muted },
    muted: { fontSize: 14, color: t.muted },
    label: { fontSize: 13, color: t.text2, fontWeight: "500" },
    h2: { fontSize: 18, fontWeight: "700", color: t.text },
    h3: { fontSize: 15, fontWeight: "700", color: t.text },
    big: { fontSize: 26, fontWeight: "700", color: t.text, fontVariant: ["tabular-nums"] },
    hero: { fontSize: 48, fontWeight: "700", color: t.text, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  };
  return (
    <Text style={[v[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return <Text style={{ color: t.critical, fontSize: 13, marginTop: 8 }}>{message}</Text>;
}

// ---------- controls ----------

type ButtonKind = "primary" | "ghost" | "soft" | "danger";

export function Button({
  title,
  onPress,
  kind = "primary",
  small = false,
  disabled = false,
  loading = false,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void | Promise<void>;
  kind?: ButtonKind;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const colors: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.accent, fg: t.accentInk, border: t.accent },
    ghost: { bg: t.surface, fg: t.text, border: t.border },
    soft: { bg: t.accentSoft, fg: t.accent, border: t.accentSoft },
    danger: { bg: "transparent", fg: t.critical, border: t.critical },
  };
  const c = colors[kind];
  const isLoading = loading || busy;
  const handle = async () => {
    if (!onPress || isLoading) return;
    const r = onPress();
    if (r instanceof Promise) {
      setBusy(true);
      try {
        await r;
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <Pressable
      onPress={handle}
      disabled={disabled || isLoading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: c.bg, borderColor: c.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={c.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={c.fg} /> : null}
          {title ? <Text style={{ color: c.fg, fontWeight: "600", fontSize: small ? 13 : 15 }}>{title}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

export function LinkButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8}>
      <Text style={{ color: t.accent, fontWeight: "500", fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  style,
  suffix,
  ...props
}: TextInputProps & { label?: string; style?: StyleProp<ViewStyle>; suffix?: string }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ marginTop: 10 }, style]}>
      {label ? (
        <Txt variant="label" style={{ marginBottom: 4 }}>
          {label}
        </Txt>
      ) : null}
      <View
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: focused ? t.accent : t.border },
        ]}
      >
        <TextInput
          placeholderTextColor={t.muted}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={{ flex: 1, color: t.text, fontSize: 15, paddingVertical: 10, outlineWidth: 0 }}
          accessibilityLabel={props.accessibilityLabel ?? label}
        />
        {suffix ? <Text style={{ color: t.muted, marginLeft: 6 }}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

/** Single choice shown as tappable chips (instead of a dropdown). */
export function Chips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  style,
}: {
  label?: string;
  options: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const selected = options.find((o) => o.value === value);
  return (
    <View style={[{ marginTop: 10 }, style]}>
      {label ? (
        <Txt variant="label" style={{ marginBottom: 6 }}>
          {label}
        </Txt>
      ) : null}
      <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                { backgroundColor: on ? t.accentSoft : t.surface, borderColor: on ? t.accent : t.border },
              ]}
            >
              <Text style={{ color: on ? t.accent : t.text, fontWeight: on ? "600" : "400", fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected?.hint ? (
        <Txt variant="tiny" style={{ marginTop: 6 }}>
          {selected.hint}
        </Txt>
      ) : null}
    </View>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[styles.row, { gap: 10, marginTop: 12, alignItems: "flex-start" }]}
    >
      <View
        style={[
          styles.checkbox,
          { borderColor: checked ? t.accent : t.muted, backgroundColor: checked ? t.accent : "transparent" },
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
      </View>
      <Txt style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const t = useTheme();
  const map = {
    neutral: [t.surface2, t.text2],
    good: [t.dark ? "#12301a" : "#e3f4e3", t.goodInk],
    warn: [t.dark ? "#3a2e10" : "#fdf0d0", t.warnInk],
    bad: [t.dark ? "#3a1a1a" : "#f8e1e1", t.critical],
    info: [t.accentSoft, t.accent],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.surface2 }]}>
      <Txt variant="tiny" style={{ color: t.text2 }}>
        {label}
      </Txt>
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

export function Meter({ value, max, color, height = 10 }: { value: number; max: number; color?: string; height?: number }) {
  const t = useTheme();
  const over = value > max;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View
      style={{ height, borderRadius: 99, backgroundColor: color ? t.surface2 : t.accentSoft, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}
    >
      <View
        style={{ width: `${pct}%`, height: "100%", borderRadius: 99, backgroundColor: over && !color ? t.critical : color ?? t.accent }}
      />
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  first = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
}) {
  const t = useTheme();
  const content = (
    <>
      <View style={{ flex: 1 }}>
        <Txt style={{ fontWeight: "500" }}>{title}</Txt>
        {subtitle ? <Txt variant="small" style={{ color: t.muted }}>{subtitle}</Txt> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={t.muted} /> : null}
    </>
  );
  const style = [styles.row, styles.listRow, { borderTopColor: t.border, borderTopWidth: first ? 0 : 1 }];
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, { borderColor: t.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={16} color={t.text2} />
    </Pressable>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

// ---------- bottom sheet ----------

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.sheet, { backgroundColor: t.bg }]}>
            <View style={[styles.grabber, { backgroundColor: t.border }]} />
            <View style={[styles.row, { justifyContent: "space-between", marginBottom: 6 }]}>
              <Txt variant="h2" style={{ flex: 1 }} numberOfLines={2}>
                {title}
              </Txt>
              <Button title="Close" kind="ghost" small onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- toast ----------

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={[styles.toast, { backgroundColor: t.text }]} accessibilityLiveRegion="polite">
            <Text style={{ color: t.bg, fontSize: 14 }}>{message}</Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- styles ----------

const styles = StyleSheet.create({
  screen: { padding: 16, paddingBottom: 40, width: "100%", maxWidth: 560, alignSelf: "center" },
  h1: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  row: { flexDirection: "row", alignItems: "center" },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12 },
  button: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    minHeight: 44,
  },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 10, minHeight: 32, borderRadius: 8 },
  input: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  chip: { borderWidth: 1.5, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: 99, paddingVertical: 3, paddingHorizontal: 8, alignSelf: "flex-start" },
  stat: { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 10, minWidth: 0 },
  listRow: { gap: 10, paddingVertical: 11 },
  iconButton: { borderWidth: 1, borderRadius: 8, padding: 6 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  grabber: { width: 40, height: 4, borderRadius: 4, alignSelf: "center", marginBottom: 10 },
  toastWrap: { position: "absolute", left: 0, right: 0, bottom: 100, alignItems: "center" },
  toast: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, maxWidth: "90%" },
});
