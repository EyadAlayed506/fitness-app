import { useMemo, useState } from "react";
import { Platform, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { fmt } from "@/lib/format";
import { useTheme } from "@/lib/theme";

import { Card, LinkButton, Row, Txt } from "./ui";

export interface ChartSeries {
  name: string;
  data: (number | null)[];
  color: string;
  /** "ref" draws a flat reference line (e.g. a target) from the first value. */
  type: "line" | "bar" | "ref";
  dots?: boolean;
}

interface ChartProps {
  labels: string[];
  series: ChartSeries[];
  stacked?: boolean;
  height?: number;
  xTitle?: string;
  digits?: number;
}

const PAD = { left: 40, right: 10, top: 8, bottom: 22 };
// SVG text falls back to a serif font in browsers; use the system UI font like the rest of the app
const FONT = Platform.OS === "web" ? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" : undefined;
const BAR_MAX = 24;
const GAP = 2;

function niceStep(range: number, count: number) {
  const raw = range / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function compact(n: number) {
  return Math.abs(n) >= 1000 ? `${fmt(n / 1000, 1)}K` : fmt(n, Math.abs(n) < 10 && n % 1 ? 1 : 0);
}

/** Path for a bar with rounded top corners and a square base. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function Chart({ labels, series, stacked = false, height = 200, xTitle, digits = 1 }: ChartProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const n = labels.length;
  const bars = series.filter((s) => s.type === "bar");
  const lines = series.filter((s) => s.type === "line");
  const refs = series.filter((s) => s.type === "ref");
  const hasBars = bars.length > 0;
  const plotH = height - PAD.top - PAD.bottom - (xTitle ? 14 : 0);
  const plotW = Math.max(0, width - PAD.left - PAD.right);

  const { ticks, yMin, yMax } = useMemo(() => {
    const values: number[] = [];
    for (const s of [...lines, ...refs]) for (const v of s.data) if (v != null) values.push(v);
    if (hasBars) {
      if (stacked) {
        for (let i = 0; i < n; i++) values.push(bars.reduce((a, s) => a + (s.data[i] ?? 0), 0));
      } else {
        for (const s of bars) for (const v of s.data) if (v != null) values.push(v);
      }
      values.push(0);
    }
    if (!values.length) return { ticks: [0, 1], yMin: 0, yMax: 1 };
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    // whole-number charts (digits = 0, e.g. counts) never get fractional ticks
    const step = digits === 0 ? Math.max(1, niceStep(hi - lo, 4)) : niceStep(hi - lo, 4);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    const list: number[] = [];
    for (let v = min; v <= max + step / 2; v += step) list.push(Math.round(v * 1e6) / 1e6);
    return { ticks: list, yMin: min, yMax: max };
  }, [series, stacked, n, digits]); // eslint-disable-line react-hooks/exhaustive-deps

  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const band = n ? plotW / n : 0;
  // Bars sit in bands; line-only charts span the full width
  const x = (i: number) => (hasBars ? PAD.left + band * (i + 0.5) : PAD.left + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2));

  // Up to ~5 x labels so they never overlap; add the last one if there's room
  const labelEvery = Math.max(1, Math.ceil(n / 5));
  const labelled = new Set<number>();
  for (let i = 0; i < n; i += labelEvery) labelled.add(i);
  const lastLabelled = Math.max(...labelled, 0);
  if (n > 1 && lastLabelled !== n - 1) {
    // always show the newest label; drop the one before it if they would be too close
    if (n - 1 - lastLabelled < labelEvery * 0.8) labelled.delete(lastLabelled);
    labelled.add(n - 1);
  }
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const pick = (locationX: number) => {
    if (!n || !plotW) return;
    const i = hasBars ? Math.floor((locationX - PAD.left) / band) : Math.round(((locationX - PAD.left) / plotW) * (n - 1));
    setSelected(Math.max(0, Math.min(n - 1, i)));
  };

  const readoutIndex = selected;

  return (
    <View>
      {series.length > 1 ? <Legend series={series} /> : null}
      <View style={{ minHeight: 34, justifyContent: "center" }}>
        {readoutIndex != null ? (
          <Row gap={10} style={{ flexWrap: "wrap" }}>
            <Txt variant="small">{labels[readoutIndex]}</Txt>
            {series.map((s) => {
              const v = s.type === "ref" ? s.data[0] : s.data[readoutIndex];
              return (
                <Row key={s.name} gap={4}>
                  <View style={{ width: 10, height: s.type === "bar" ? 10 : 3, borderRadius: 2, backgroundColor: s.type === "ref" ? t.muted : s.color }} />
                  <Text style={{ color: t.text, fontWeight: "600", fontSize: 13 }}>{v == null ? "–" : fmt(v, digits)}</Text>
                  <Text style={{ color: t.muted, fontSize: 12 }}>{s.name}</Text>
                </Row>
              );
            })}
          </Row>
        ) : (
          <Txt variant="tiny">Tap the chart to see values</Txt>
        )}
      </View>
      <View
        onLayout={onLayout}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => pick(e.nativeEvent.locationX)}
        onResponderMove={(e) => pick(e.nativeEvent.locationX)}
        accessibilityRole="image"
        accessibilityLabel={`Chart: ${series.map((s) => s.name).join(", ")}`}
      >
        {width > 0 ? (
          <Svg width={width} height={height} pointerEvents="none">
            {ticks.map((v) => (
              <G key={v}>
                <Line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke={t.grid} strokeWidth={1} />
                <SvgText x={PAD.left - 6} y={y(v) + 4} fontSize={10} fill={t.text2} textAnchor="end" fontFamily={FONT}>
                  {compact(v)}
                </SvgText>
              </G>
            ))}
            {labels.map((l, i) =>
              labelled.has(i) ? (
                <SvgText
                  key={`x${i}`}
                  x={x(i)}
                  y={PAD.top + plotH + 15}
                  fontSize={10}
                  fill={t.text2}
                  fontFamily={FONT}
                  textAnchor={hasBars ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                >
                  {l}
                </SvgText>
              ) : null,
            )}
            {xTitle ? (
              <SvgText x={PAD.left + plotW / 2} y={height - 2} fontSize={10} fill={t.text2} textAnchor="middle" fontFamily={FONT}>
                {xTitle}
              </SvgText>
            ) : null}

            {/* bars */}
            {hasBars &&
              labels.map((_, i) => {
                if (stacked) {
                  const w = Math.min(BAR_MAX, band * 0.7);
                  let base = 0;
                  const segs = bars.map((s) => ({ s, v: s.data[i] ?? 0 })).filter((d) => d.v > 0);
                  return segs.map(({ s, v }, k) => {
                    const top = y(base + v);
                    const bottom = y(base) - (k > 0 ? GAP : 0);
                    base += v;
                    const h = Math.max(0, bottom - top);
                    const isTop = k === segs.length - 1;
                    return (
                      <Path
                        key={`${s.name}${i}`}
                        d={topRoundedRect(x(i) - w / 2, top, w, h, isTop ? 4 : 0)}
                        fill={s.color}
                        opacity={selected == null || selected === i ? 1 : 0.55}
                      />
                    );
                  });
                }
                const k = bars.length;
                const w = Math.min(BAR_MAX, (band * 0.8 - GAP * (k - 1)) / k);
                const groupW = w * k + GAP * (k - 1);
                return bars.map((s, j) => {
                  const v = s.data[i];
                  if (v == null || v <= 0) return null;
                  const top = y(v);
                  return (
                    <Path
                      key={`${s.name}${i}`}
                      d={topRoundedRect(x(i) - groupW / 2 + j * (w + GAP), top, w, y(0) - top, 4)}
                      fill={s.color}
                      opacity={selected == null || selected === i ? 1 : 0.55}
                    />
                  );
                });
              })}

            {/* reference lines */}
            {refs.map((s) =>
              s.data[0] == null ? null : (
                <Line key={s.name} x1={PAD.left} x2={width - PAD.right} y1={y(s.data[0])} y2={y(s.data[0])} stroke={t.muted} strokeWidth={1.5} />
              ),
            )}

            {/* crosshair */}
            {selected != null && !hasBars ? (
              <Line x1={x(selected)} x2={x(selected)} y1={PAD.top} y2={PAD.top + plotH} stroke={t.muted} strokeWidth={1} />
            ) : null}

            {/* lines */}
            {lines.map((s) => {
              let d = "";
              let pen = false;
              s.data.forEach((v, i) => {
                if (v == null) {
                  pen = false;
                  return;
                }
                d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
                pen = true;
              });
              return (
                <G key={s.name}>
                  <Path d={d} stroke={s.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  {s.dots &&
                    s.data.map((v, i) =>
                      v == null ? null : <Circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={s.color} stroke={t.surface} strokeWidth={1.5} />,
                    )}
                  {selected != null && s.data[selected] != null ? (
                    <Circle cx={x(selected)} cy={y(s.data[selected]!)} r={5} fill={s.color} stroke={t.surface} strokeWidth={2} />
                  ) : null}
                </G>
              );
            })}
            {selected != null && hasBars ? (
              <Rect x={PAD.left + band * selected} y={PAD.top} width={band} height={plotH} fill={t.text} opacity={0.04} />
            ) : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  const t = useTheme();
  return (
    <Row gap={12} style={{ flexWrap: "wrap", marginBottom: 2 }}>
      {series.map((s) => (
        <Row key={s.name} gap={5}>
          <View
            style={{
              width: s.type === "bar" ? 10 : 14,
              height: s.type === "bar" ? 10 : 2.5,
              borderRadius: 2,
              backgroundColor: s.type === "ref" ? t.muted : s.color,
            }}
          />
          <Text style={{ color: t.text2, fontSize: 12 }}>{s.name}</Text>
        </Row>
      ))}
    </Row>
  );
}

/** A card with a title, the chart, an empty state and a table view of the same numbers. */
export function ChartCard({
  title,
  subtitle,
  empty,
  emptyText,
  children,
  table,
}: {
  title: string;
  subtitle?: string;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
  table?: { labels: string[]; series: ChartSeries[]; digits?: number };
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card>
      <Row style={{ justifyContent: "space-between", marginBottom: 2 }}>
        <Txt variant="h3" style={{ flex: 1 }}>
          {title}
        </Txt>
        {!empty && table ? <LinkButton title={showTable ? "Chart" : "Table"} onPress={() => setShowTable(!showTable)} /> : null}
      </Row>
      {subtitle ? (
        <Txt variant="small" style={{ marginBottom: 4 }}>
          {subtitle}
        </Txt>
      ) : null}
      {empty ? (
        <View style={{ height: 110, alignItems: "center", justifyContent: "center" }}>
          <Txt variant="muted" style={{ textAlign: "center" }}>
            {emptyText}
          </Txt>
        </View>
      ) : showTable && table ? (
        <DataTable labels={table.labels} series={table.series} digits={table.digits ?? 1} />
      ) : (
        children
      )}
    </Card>
  );
}

function DataTable({ labels, series, digits }: { labels: string[]; series: ChartSeries[]; digits: number }) {
  const t = useTheme();
  const cell = { flex: 1, textAlign: "right" as const, fontSize: 13, color: t.text, fontVariant: ["tabular-nums" as const] };
  return (
    <View style={{ marginTop: 6 }}>
      <Row style={{ paddingVertical: 6 }}>
        <Text style={{ flex: 1.2, color: t.text2, fontSize: 12 }} />
        {series.map((s) => (
          <Text key={s.name} style={[cell, { color: t.text2, fontSize: 12 }]}>
            {s.name}
          </Text>
        ))}
      </Row>
      {labels.map((l, i) => (
        <Row key={`${l}${i}`} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.border }}>
          <Text style={{ flex: 1.2, color: t.text, fontSize: 13 }}>{l}</Text>
          {series.map((s) => {
            const v = s.type === "ref" ? s.data[0] : s.data[i];
            return (
              <Text key={s.name} style={cell}>
                {v == null ? "–" : fmt(v, digits)}
              </Text>
            );
          })}
        </Row>
      ))}
    </View>
  );
}
