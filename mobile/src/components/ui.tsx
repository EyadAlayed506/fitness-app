import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
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

import { setConfirmHandler, type ConfirmRequest } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
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

type ButtonKind = "primary" | "ghost" | "soft" | "danger" | "destructive";

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
    destructive: { bg: t.critical, fg: t.criticalText, border: t.critical },
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

/**
 * A number with big − and + buttons, so the common case needs no keyboard (the number can still be typed).
 * Holding a button keeps counting.
 */
export function Stepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  max = 9999,
  decimals = 1,
  suffix,
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  min?: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const bump = useCallback(
    (direction: 1 | -1) => {
      const current = Number(latest.current.value.replace(",", ".")) || 0;
      const next = Math.min(max, Math.max(min, current + direction * step));
      const text = String(Number(next.toFixed(decimals)));
      if (text === latest.current.value) return;
      latest.current = { ...latest.current, value: text };
      latest.current.onChange(text);
      haptics.selection();
    },
    [min, max, step, decimals],
  );
  const button = (direction: 1 | -1) => (
    <Pressable
      onPress={() => bump(direction)}
      onLongPress={() => {
        stop();
        repeat.current = setInterval(() => bump(direction), 90);
      }}
      onPressOut={stop}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${direction > 0 ? "More" : "Less"} ${label.toLowerCase()}, ${direction > 0 ? "+" : "−"}${step}`}
      hitSlop={4}
      style={({ pressed }) => [styles.stepButton, { backgroundColor: t.surface }, pressed && styles.pressed]}
    >
      <Ionicons name={direction > 0 ? "add" : "remove"} size={22} color={t.text} />
    </Pressable>
  );
  return (
    <View style={[{ marginTop: space.md, minWidth: 0 }, style]}>
      <Txt variant="label" style={{ marginBottom: 6 }} numberOfLines={1}>
        {label}
      </Txt>
      <View style={[styles.stepper, { backgroundColor: t.surface2 }]}>
        {button(-1)}
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", justifyContent: "center" }}>
          <TextInput
            value={value}
            onChangeText={onChange}
            keyboardType="decimal-pad"
            selectTextOnFocus
            accessibilityLabel={label}
            style={{
              fontSize: 24,
              fontWeight: "700",
              color: t.text,
              textAlign: "center",
              width: "100%",
              maxWidth: 110,
              minWidth: 0,
              paddingVertical: 4,
              outlineWidth: 0,
              fontVariant: ["tabular-nums"],
            }}
          />
          {suffix ? <Text style={[typeScale.small, { color: t.muted, marginLeft: 2 }]}>{suffix}</Text> : null}
        </View>
        {button(1)}
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
              onPress={() => {
                if (!on) haptics.selection();
                onChange(o.value);
              }}
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
              onPress={() => {
                if (!on) haptics.selection();
                onChange(o.value);
              }}
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
  const text = (
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
    </>
  );
  const style = [styles.row, styles.listRow, { borderTopColor: t.border, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }];
  if (!onPress)
    return (
      <View style={style}>
        {text}
        {right}
      </View>
    );
  if (!right)
    return (
      <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [style, { opacity: pressed ? 0.6 : 1 }]}>
        {text}
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Pressable>
    );
  // a tappable row with its own buttons on the right: side by side, never a button inside a button
  return (
    <View style={style}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, { flex: 1, minWidth: 0, gap: space.md, alignSelf: "stretch", opacity: pressed ? 0.6 : 1 }]}
      >
        {text}
      </Pressable>
      {right}
    </View>
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

/** A panel that slides up from the bottom. Drag its top edge down, tap outside, or tap × to close it. */
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
  const reduced = useReducedMotion();
  const [drag] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);
  const pan = useMemo(() => {
    const settle = () =>
      Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== "web", bounciness: 0, speed: 20 }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 110 || (g.dy > 30 && g.vy > 0.9)) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, onClose]);
  return (
    <Modal visible={visible} transparent animationType={reduced ? "fade" : "slide"} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          <Animated.View style={[styles.sheet, { backgroundColor: t.surface, transform: [{ translateY: drag }] }]}>
            {/* the drag area; in a browser, selecting the title text would cancel the drag */}
            <View {...pan.panHandlers} testID="sheet-handle" style={noSelect}>
              <View style={[styles.grabber, { backgroundColor: t.border }]} />
              <View style={[styles.row, { justifyContent: "space-between", marginBottom: space.sm, gap: space.md }]}>
                <Txt variant="h2" style={{ flex: 1 }} numberOfLines={2} selectable={false}>
                  {title}
                </Txt>
                <IconButton icon="close" label="Close" onPress={onClose} />
              </View>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.xl + insets.bottom }}>
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- dialog ----------

/** Shows the app's own yes/no dialog for every `confirm()` call (see lib/confirm.ts). */
export function DialogProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [request, setRequest] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  useEffect(() => {
    setConfirmHandler(
      (r) =>
        new Promise<boolean>((resolve) => {
          setRequest((previous) => {
            previous?.resolve(false); // only one question at a time
            return { ...r, resolve };
          });
        }),
    );
    return () => setConfirmHandler(null);
  }, []);
  const answer = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <>
      {children}
      <Modal visible={!!request} transparent animationType={reduced ? "none" : "fade"} onRequestClose={() => answer(false)}>
        <View style={[styles.dialogBackdrop, { backgroundColor: t.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => answer(false)} accessibilityLabel="Cancel" />
          {request ? (
            <View style={[styles.dialog, { backgroundColor: t.surface }]} accessibilityViewIsModal accessibilityRole="alert">
              <Txt variant="h2">{request.title}</Txt>
              <Txt variant="small" style={{ marginTop: space.sm }}>
                {request.message}
              </Txt>
              <View style={[styles.row, { marginTop: space.xl, gap: space.sm }]}>
                <Button title="Cancel" kind="soft" onPress={() => answer(false)} style={{ flex: 1 }} />
                <Button
                  title={request.okLabel}
                  kind={request.destructive ? "destructive" : "primary"}
                  onPress={() => answer(true)}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

// ---------- toast ----------

export interface ToastOptions {
  /** e.g. Undo. The message stays a little longer when it has an action. */
  action?: { label: string; onPress: () => void };
}
type ShowToast = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});
const ToastInsetContext = createContext<(px: number) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; action?: ToastOptions["action"] } | null>(null);
  const [extraInset, setExtraInset] = useState(0);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 0, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start(() =>
      setToast(null),
    );
  }, [opacity]);
  const show = useCallback<ShowToast>(
    (message, options) => {
      setToast({ message, action: options?.action });
      Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: Platform.OS !== "web" }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, options?.action ? 5000 : 2600);
    },
    [opacity, hide],
  );
  return (
    <ToastContext.Provider value={show}>
      <ToastInsetContext.Provider value={setExtraInset}>
        {children}
        {toast ? (
          <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: size.tabBar + insets.bottom + space.lg + extraInset }]}>
            <Animated.View style={[styles.toast, { backgroundColor: t.ink, opacity }]} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={18} color={t.inkText} />
              <Text style={[typeScale.small, { color: t.inkText, flexShrink: 1 }]}>{toast.message}</Text>
              {toast.action ? (
                <Pressable
                  onPress={() => {
                    toast.action?.onPress();
                    hide();
                  }}
                  accessibilityRole="button"
                  hitSlop={10}
                  style={({ pressed }) => [styles.toastAction, { borderLeftColor: t.muted, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[typeScale.label, { color: t.inkText, textDecorationLine: "underline" }]}>{toast.action.label}</Text>
                </Pressable>
              ) : null}
            </Animated.View>
          </View>
        ) : null}
      </ToastInsetContext.Provider>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Lift toasts above something pinned to the bottom of the screen (e.g. the workout bar) while it's shown. */
export function useToastInset(px: number) {
  const set = useContext(ToastInsetContext);
  useEffect(() => {
    set(px);
    return () => set(0);
  }, [px, set]);
}

// ---------- styles ----------

/** Browsers only: text that can't be selected (React Native's types don't list `userSelect` for views). */
const noSelect = (Platform.OS === "web" ? { userSelect: "none" } : {}) as ViewStyle;

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
  toastAction: { marginLeft: space.xs, paddingLeft: space.md, borderLeftWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: "row", alignItems: "center", borderRadius: radius.md, padding: 4, minHeight: 56, gap: 4 },
  stepButton: { width: 48, height: 48, borderRadius: radius.md - 2, alignItems: "center", justifyContent: "center" },
  dialogBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  dialog: { width: "100%", maxWidth: 360, borderRadius: radius.xl, padding: space.xl },
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
