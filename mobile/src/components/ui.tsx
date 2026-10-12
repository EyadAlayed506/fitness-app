import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { motion, radius, size, space, type as typeScale, useTheme } from "@/lib/theme";

export type IconName = keyof typeof Ionicons.glyphMap;

// ---------- motion ----------

/** True when the user asked the system for less motion. Animations are skipped then. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** A short fade-and-rise when content first appears. Nothing moves with reduced motion. */
export function FadeIn({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: motion.slow, delay, useNativeDriver: Platform.OS !== "web" }).start();
  }, [progress, delay]);
  if (reduced) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      style={[
        style,
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ---------- layout ----------

export function Screen({
  title,
  subtitle,
  right,
  children,
  onRefresh,
  refreshing = false,
  back = false,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** show a back button (for screens opened from another screen, e.g. Profile from Today) */
  back?: boolean;
}) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.muted} /> : undefined}
      >
        {back ? (
          <View style={{ marginBottom: space.md, marginLeft: -2 }}>
            <IconButton icon="chevron-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/home"))} />
          </View>
        ) : null}
        <View style={[styles.row, { justifyContent: "space-between", alignItems: "flex-end", marginBottom: space.lg, gap: space.md }]}>
          <View style={{ flex: 1 }}>
            {subtitle ? (
              <Text style={[typeScale.overline, { color: t.muted, marginBottom: 2 }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            <Text style={[typeScale.title, { color: t.text }]} accessibilityRole="header" numberOfLines={2}>
              {title}
            </Text>
          </View>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A surface for one group of related content. Don't put cards inside cards. */
export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const base = [
    styles.card,
    { backgroundColor: t.surface, borderColor: t.dark ? t.border : "transparent", shadowColor: t.dark ? "transparent" : "#000" },
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [base, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={[styles.row, { justifyContent: "space-between", marginBottom: space.md, gap: space.sm }]}>
      <Txt variant="h3" style={{ flex: 1 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

/** A heading between groups of content, with an optional link on the right. */
export function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={[styles.row, { justifyContent: "space-between", marginTop: space.xl, marginBottom: space.sm + 2 }]}>
      <Text style={[typeScale.heading, { color: t.text }]} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? <LinkButton title={action} onPress={onAction} /> : null}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[styles.row, { gap }, style]}>{children}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: inset }} />;
}

// ---------- text ----------

type Variant = "body" | "small" | "tiny" | "muted" | "h2" | "h3" | "big" | "hero" | "label";

export function Txt({
  children,
  variant = "body",
  style,
  numberOfLines,
  selectable,
}: {
  children: ReactNode;
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** lets the user select and copy the text (e.g. a URL to paste elsewhere) */
  selectable?: boolean;
}) {
  const t = useTheme();
  const v: Record<Variant, TextStyle> = {
    body: { ...typeScale.body, color: t.text },
    small: { ...typeScale.small, color: t.text2 },
    tiny: { ...typeScale.caption, color: t.muted },
    muted: { ...typeScale.body, color: t.muted },
    label: { ...typeScale.label, color: t.text2 },
    h2: { ...typeScale.heading, color: t.text },
    h3: { ...typeScale.bodyStrong, color: t.text },
    big: { fontSize: 28, fontWeight: "700", letterSpacing: -0.6, lineHeight: 32, color: t.text, fontVariant: ["tabular-nums"] },
    hero: { ...typeScale.display, fontSize: 44, lineHeight: 48, color: t.text, fontVariant: ["tabular-nums"] },
  };
  return (
    <Text style={[v[variant], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <View style={[styles.row, { gap: 6, marginTop: space.sm, alignItems: "flex-start" }]} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={t.critical} style={{ marginTop: 1 }} />
      <Text style={[typeScale.small, { color: t.critical, flex: 1 }]}>{message}</Text>
    </View>
  );
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
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const colors: Record<ButtonKind, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.ink, fg: t.inkText, border: t.ink },
    ghost: { bg: "transparent", fg: t.text, border: t.border },
    soft: { bg: t.surface2, fg: t.text, border: t.surface2 },
    danger: { bg: "transparent", fg: t.critical, border: t.criticalSoft },
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
      accessibilityState={{ disabled: disabled || isLoading, busy: isLoading }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: c.bg, borderColor: c.border, opacity: disabled ? 0.4 : 1 },
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={c.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? size.iconSmall : 18} color={c.fg} /> : null}
          {title ? (
            <Text style={[small ? typeScale.label : typeScale.bodyStrong, { color: c.fg }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export function LinkButton({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
      <Text style={[typeScale.label, { color: t.accent }]}>{title}</Text>
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
    <View style={[{ marginTop: space.md, minWidth: 0 }, style]}>
      {label ? (
        <Txt variant="label" style={{ marginBottom: 6 }} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
      <View
        style={[
          styles.input,
          props.multiline && { minHeight: 88, alignItems: "flex-start", paddingTop: 4 },
          { backgroundColor: t.surface2, borderColor: focused ? t.accent : "transparent" },
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
          style={[typeScale.body, { flex: 1, minWidth: 0, width: "100%", color: t.text, paddingVertical: 12, outlineWidth: 0 }]}
          accessibilityLabel={props.accessibilityLabel ?? label}
        />
        {suffix ? <Text style={[typeScale.small, { color: t.muted, marginLeft: 6 }]}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

/** Single choice shown as tappable pills (instead of a dropdown). */
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
    <View style={[{ marginTop: space.md }, style]}>
      {label ? (
        <Txt variant="label" style={{ marginBottom: space.sm }}>
          {label}
        </Txt>
      ) : null}
      <View style={[styles.row, { flexWrap: "wrap", gap: space.sm }]} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: on ? t.ink : t.surface2 },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[typeScale.label, { color: on ? t.inkText : t.text, fontWeight: on ? "600" : "500" }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {selected?.hint ? (
        <Txt variant="tiny" style={{ marginTop: space.sm }}>
          {selected.hint}
        </Txt>
      ) : null}
    </View>
  );
}

/** A row of mutually exclusive views (e.g. sections of a screen). Scrolls sideways if it doesn't fit. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.surface2, borderRadius: radius.md, padding: 3 }, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, gap: 2 }} accessibilityRole="tablist">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [
                {
                  flexGrow: 1,
                  minHeight: 36,
                  paddingHorizontal: space.md,
                  borderRadius: radius.sm + 1,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? t.surface : "transparent",
                  shadowColor: "#000",
                  shadowOpacity: on && !t.dark ? 0.08 : 0,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                },
                pressed && !on && { opacity: 0.6 },
              ]}
            >
              <Text style={[typeScale.label, { color: on ? t.text : t.text2 }]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
      style={[styles.row, { gap: space.md, marginTop: space.md, alignItems: "flex-start", minHeight: 24 }]}
    >
      <View style={[styles.checkbox, { borderColor: checked ? t.ink : t.muted, backgroundColor: checked ? t.ink : "transparent" }]}>
        {checked ? <Ionicons name="checkmark" size={15} color={t.inkText} /> : null}
      </View>
      <Txt style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const t = useTheme();
  const map: Record<Tone, [string, string]> = {
    neutral: [t.surface2, t.text2],
    good: [t.goodSoft, t.goodInk],
    warn: [t.warnSoft, t.warnInk],
    bad: [t.criticalSoft, t.critical],
    info: [t.accentSoft, t.accent],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[typeScale.caption, { color: fg, fontWeight: "600" }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A number with its label. Several in a Row read as a summary line, without boxes. */
export function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={[typeScale.caption, { color: t.muted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: "700", letterSpacing: -0.3, fontVariant: ["tabular-nums"] }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export function Meter({ value, max, color, height = 6 }: { value: number; max: number; color?: string; height?: number }) {
  const t = useTheme();
  const over = value > max;
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View
      style={{ height, borderRadius: radius.pill, backgroundColor: t.surface2, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}
    >
      <View
        style={{ width: `${pct}%`, height: "100%", borderRadius: radius.pill, backgroundColor: over && !color ? t.warn : color ?? t.accent }}
      />
    </View>
  );
}

/** A circular progress indicator with content in the middle (e.g. today's calories). */
export function ProgressRing({
  value,
  max,
  diameter = 120,
  stroke = 10,
  color,
  children,
  label,
}: {
  value: number;
  max: number;
  diameter?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  label: string;
}) {
  const t = useTheme();
  const r = (diameter - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      style={{ width: diameter, height: diameter, alignItems: "center", justifyContent: "center" }}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(value) }}
    >
      <Svg width={diameter} height={diameter} style={StyleSheet.absoluteFill}>
        <Circle cx={diameter / 2} cy={diameter / 2} r={r} stroke={t.surface2} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
          <Circle
            cx={diameter / 2}
            cy={diameter / 2}
            r={r}
            stroke={color ?? t.accent}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={circumference * (1 - pct)}
            transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  right,
  onPress,
  first = false,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  icon?: IconName;
}) {
  const t = useTheme();
  const content = (
    <>
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: t.surface2 }]}>
          <Ionicons name={icon} size={18} color={t.text2} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={{ fontWeight: "500" }} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="small" style={{ color: t.muted }}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={t.muted} /> : null}
    </>
  );
  const style = [styles.row, styles.listRow, { borderTopColor: t.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }];
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
      {content}
    </Pressable>
  ) : (
    <View style={style}>{content}</View>
  );
}

export function IconButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: t.surface2 }, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={18} color={t.text2} />
    </Pressable>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
      <ActivityIndicator color={t.muted} />
    </View>
  );
}

/** A grey placeholder in the shape of content that's still loading (pulses gently). */
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[{ height, width, borderRadius: radius.sm, backgroundColor: t.surface2, opacity: pulse }, style]}
    />
  );
}

/** Placeholder cards while a screen loads. */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <Skeleton width="40%" height={14} />
          <Skeleton height={28} width="60%" style={{ marginTop: space.md }} />
          <Skeleton height={8} style={{ marginTop: space.md }} />
        </Card>
      ))}
    </View>
  );
}

/** What to show when there's nothing yet: a short line, and the action that fixes it. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void | Promise<void>;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={[styles.emptyIcon, { backgroundColor: t.surface2 }]}>
        <Ionicons name={icon} size={22} color={t.text2} />
      </View>
      <Txt style={{ fontWeight: "600", textAlign: "center" }}>{title}</Txt>
      {text ? (
        <Txt variant="small" style={{ textAlign: "center", maxWidth: 300 }}>
          {text}
        </Txt>
      ) : null}
      {action && onAction ? <Button title={action} small kind="soft" onPress={onAction} style={{ marginTop: space.xs }} /> : null}
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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.sheet, { backgroundColor: t.surface }]}>
            <View style={[styles.grabber, { backgroundColor: t.border }]} />
            <View style={[styles.row, { justifyContent: "space-between", marginBottom: space.sm, gap: space.md }]}>
              <Txt variant="h2" style={{ flex: 1 }} numberOfLines={2}>
                {title}
              </Txt>
              <IconButton icon="close" label="Close" onPress={onClose} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xl + insets.bottom }}>
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
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (msg: string) => {
      setMessage(msg);
      Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start(() =>
          setMessage(null),
        );
      }, 2600);
    },
    [opacity],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message ? (
        <View pointerEvents="none" style={[styles.toastWrap, { bottom: size.tabBar + insets.bottom + space.lg }]}>
          <Animated.View style={[styles.toast, { backgroundColor: t.ink, opacity }]} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={18} color={t.inkText} />
            <Text style={[typeScale.small, { color: t.inkText, flexShrink: 1 }]}>{message}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- styles ----------

const styles = StyleSheet.create({
  screen: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xxl, width: "100%", maxWidth: 600, alignSelf: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  button: {
    flexDirection: "row",
    gap: space.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: size.button,
  },
  buttonSmall: { paddingHorizontal: space.md, minHeight: size.buttonSmall, borderRadius: radius.sm + 2 },
  input: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: space.md + 2,
    minHeight: size.input,
  },
  chip: { borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: "center" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9, alignSelf: "flex-start" },
  listRow: { gap: space.md, paddingVertical: space.md, minHeight: 52 },
  rowIcon: { width: 34, height: 34, borderRadius: radius.sm + 2, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  emptyIcon: { width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    maxHeight: "92%",
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  grabber: { width: 36, height: 4, borderRadius: 4, alignSelf: "center", marginBottom: space.md },
  toastWrap: { position: "absolute", left: space.lg, right: space.lg, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    maxWidth: 520,
  },
});
