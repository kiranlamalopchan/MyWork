/**
 * The trend card: what was earned across a span — a week or a fortnight by
 * day, a month by week, or six months by month — drawn as one soft line over
 * the span before it, so "is this a good week?" is answered at a glance.
 *
 * The total sits on top with how it compares; the line is the current span,
 * filled underneath; the thinner line is the one before. Tap a day (on the
 * chart or on the row of days under it) to read it: the bubble says what it
 * came to, and the line under the chart sets it against the same day before.
 * A job with no rate is counted in hours instead of money.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

import { useTrend, type Trend, type TrendFigure, type TrendRange } from "@/api";

import { tick } from "./haptics";
import { Card } from "./index";
import { radius, sp, useTheme } from "./theme";

const CHART_H = 178;
/** Room above the highest point for the bubble. */
const TOP = 46;
const BOTTOM = 10;
const PILL_GAP = 6;
const SIDE = 12;

const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TrendChart({ workplace, testID = "trend" }: { workplace?: number | null; testID?: string }) {
  const [range, setRange] = useState<TrendRange>("week");
  const q = useTrend(range, workplace);
  const data = q.data;
  if (!data) return q.isLoading ? <Card style={{ height: 330 }} testID={`${testID}-loading`}><View /></Card> : null;
  return <TrendCard data={data} range={range} onRange={setRange} testID={testID} />;
}

function TrendCard({ data, range, onRange, testID }: { data: Trend; range: TrendRange; onRange: (r: TrendRange) => void; testID: string }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ range: TrendRange; index: number } | null>(null);
  const [bubbleW, setBubbleW] = useState(0);
  const n = data.points.length;
  const current = Math.max(0, data.points.findIndex((p) => p.current));
  // A choice made for one span means nothing in another: back to "now".
  const selected = picked && picked.range === data.range && picked.index < n ? picked.index : current;

  const value = (f: TrendFigure) => (data.priced ? f.gross ?? 0 : f.hours);
  const say = (f: TrendFigure) => (data.priced ? money(f.gross ?? 0) : f.worked.hm);

  // Where each day's pill sits, so the chart's day lines run straight down into it.
  // A fortnight's fourteen days still fit in one row, on slimmer pills.
  const dense = n > 7;
  const gap = dense ? 3 : PILL_GAP;
  const pill = width ? (width - SIDE * 2 - gap * (n - 1)) / n : 0;
  const xs = useMemo(() => data.points.map((_, i) => SIDE + i * (pill + gap) + pill / 2), [data.points, pill, gap]);
  const top = Math.max(1, ...data.points.map(value), ...data.previous.map(value)) * 1.12;
  const y = (v: number) => TOP + (CHART_H - TOP - BOTTOM) * (1 - v / top);

  const done = data.points.filter((p) => !p.upcoming).length;
  const now = data.points.slice(0, Math.max(done, 1)).map((p, i) => ({ x: xs[i], y: y(value(p)) }));
  const before = data.previous.map((p, i) => ({ x: xs[i], y: y(value(p)) }));
  // Both lines run on to the card's edge from their first point, and the
  // finished one to the far edge, the way the line of a running total would.
  const nowLine = width ? smooth([{ x: 0, y: now[0].y }, ...now, ...(done === n ? [{ x: width, y: now[now.length - 1].y }] : [])]) : "";
  const beforeLine = width ? smooth([{ x: 0, y: before[0].y }, ...before, { x: width, y: before[before.length - 1].y }]) : "";
  const lastX = done === n ? width : now[now.length - 1]?.x ?? 0;
  const fill = nowLine ? `${nowLine} L ${lastX} ${CHART_H} L 0 ${CHART_H} Z` : "";

  const choose = (index: number) => {
    const i = Math.max(0, Math.min(n - 1, index));
    if (i !== selected) tick();
    setPicked({ range: data.range, index: i });
  };
  const fromTouch = (e: GestureResponderEvent) => {
    if (!pill) return;
    choose(Math.round((e.nativeEvent.locationX - SIDE - pill / 2) / (pill + gap)));
  };

  const point = data.points[selected];
  const then = data.previous[selected];
  const sx = xs[selected] ?? 0;
  const sy = point && !point.upcoming ? y(value(point)) : null;
  const bubble = point ? (point.upcoming ? "Still to come" : say(point)) : "";
  const bubbleX = Math.max(8, Math.min(width - bubbleW - 8, sx - bubbleW / 2));

  // Like against like: a span still under way is set against the same stretch
  // of the one before (Sunday to Monday against last Sunday to Monday), not
  // against all of it — or every week would start "down 100%".
  const sum = (list: TrendFigure[]) => list.slice(0, Math.max(done, 1)).reduce((a, f) => a + value(f), 0);
  const change = delta(sum(data.points), sum(data.previous));
  const ink = t.dark ? t.text : "#111111";
  const inkText = t.dark ? "#000000" : "#ffffff";
  const id = `trend-${React.useId()}`;

  return (
    <Card pad={false} style={styles.card} testID={testID}>
      <SpanSwitch value={range} onChange={onRange} options={data.ranges} />
      <Text style={[styles.kicker, { color: t.muted }]}>{data.priced ? "Earned" : "Worked"}</Text>
      <View style={styles.amountRow}>
        <Text style={[styles.amount, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} testID={`${testID}-total`}>{say(data.total)}</Text>
        {change ? (
          <View style={[styles.change, { backgroundColor: change.up ? t.brandSoft : t.warnSoft }]}
            accessibilityLabel={`${change.up ? "Up" : "Down"} ${change.text} on ${data.compare_title.toLowerCase()} at this point`}>
            <Ionicons name={change.up ? "arrow-up" : "arrow-down"} size={12} color={change.up ? t.brand : t.warn} />
            <Text style={{ color: change.up ? t.brand : t.warn, fontSize: 12.5, fontWeight: "700" }}>{change.text}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.legend}>
        <Key colour={t.brand} label={data.title} />
        <Key colour={t.orange} label={data.compare_title} />
      </View>

      <View style={{ height: CHART_H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true} onResponderGrant={fromTouch} onResponderMove={fromTouch} onResponderTerminationRequest={() => true}
        accessibilityLabel={`${data.title}: ${say(data.total)}. ${data.compare_title}: ${say(data.previous_total)}.`}>
        {width ? (
          <Svg width={width} height={CHART_H}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.brand} stopOpacity={0.26} />
                <Stop offset="0.75" stopColor={t.brand} stopOpacity={0.04} />
                <Stop offset="1" stopColor={t.brand} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {xs.map((x, i) => i === selected ? null : <Line key={i} x1={x} x2={x} y1={TOP - 14} y2={CHART_H} stroke={t.line} strokeWidth={1} strokeDasharray="4 6" />)}
            <Path d={fill} fill={`url(#${id})`} />
            <Path d={beforeLine} stroke={t.orange} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.9} />
            <Path d={nowLine} stroke={t.brand} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            <Line x1={sx} x2={sx} y1={TOP - 6} y2={CHART_H} stroke={t.brand} strokeWidth={1.2} strokeDasharray="4 4" />
            {sy !== null ? <>
              <Circle cx={sx} cy={sy} r={8} fill={t.surface} />
              <Circle cx={sx} cy={sy} r={5.5} fill={t.brand} />
            </> : null}
          </Svg>
        ) : null}
        {width && point ? <>
          <View pointerEvents="none" style={[styles.tail, { left: sx - 5, backgroundColor: ink }]} />
          <View pointerEvents="none" onLayout={(e) => setBubbleW(e.nativeEvent.layout.width)} style={[styles.bubble, { left: bubbleX, maxWidth: width - 16, backgroundColor: ink, opacity: bubbleW ? 1 : 0 }]} testID={`${testID}-bubble`}>
            <Text style={{ color: inkText, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>{bubble}</Text>
          </View>
        </> : null}
      </View>

      {point ? (
        <Text style={[styles.caption, { color: t.muted }]} numberOfLines={1} testID={`${testID}-caption`}>
          {point.long_label}{data.priced && !point.upcoming ? ` · ${point.worked.hm}` : ""} · {data.compare_title.toLowerCase()} {say(then)}
        </Text>
      ) : null}
      <View style={[styles.pills, { gap }]}>
        {data.points.map((p, i) => {
          const on = i === selected;
          return (
            <Text key={p.start} onPress={() => choose(i)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={p.long_label}
              numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
              style={[styles.pill, dense && styles.pillDense, { backgroundColor: on ? ink : "transparent", borderColor: on ? ink : t.line, color: on ? inkText : p.upcoming ? t.muted : t.text }]}>
              {p.label}
            </Text>
          );
        })}
      </View>
    </Card>
  );
}

/**
 * Weekly, Fortnightly, Monthly, 6 months: four parts that always fit
 * the card, where a scrolling row would leave the last one half off the edge.
 */
function SpanSwitch({ value, onChange, options }: { value: TrendRange; onChange: (r: TrendRange) => void; options: { value: TrendRange; label: string }[] }) {
  const t = useTheme();
  return (
    <View style={[styles.switch, { backgroundColor: t.dark ? t.surface2 : t.track }]} accessibilityRole="tablist" accessibilityLabel="Chart span">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            onPress={() => { if (!on) { tick(); onChange(o.value); } }}
            style={[styles.span, on && [styles.spanOn, { backgroundColor: t.dark ? t.surface3 : t.surface }]]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: on ? t.text : t.muted, fontSize: 13.5, fontWeight: on ? "700" : "600" }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Key({ colour, label }: { colour: string; label: string }) {
  const t = useTheme();
  return (
    <View style={styles.key}>
      <View style={[styles.dot, { backgroundColor: colour }]} />
      <Text style={{ color: t.muted, fontSize: 12.5 }}>{label}</Text>
    </View>
  );
}

/** How this span did against the one before, as words — nothing when there is nothing to compare. */
export function delta(now: number, then: number): { up: boolean; text: string } | null {
  if (!now && !then) return null;
  if (!then) return { up: true, text: "New" };
  const pct = Math.round(((now - then) / then) * 100);
  if (pct === 0) return null;
  return { up: pct > 0, text: `${Math.abs(pct)}%` };
}

/**
 * A smooth line through the points that never swings past them — a
 * monotone cubic (Fritsch–Carlson), so a quiet day between two busy ones
 * dips to its own value and not below the axis.
 */
export function smooth(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const n = pts.length;
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6);
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const tan = pts.map((_, i) => (i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d += ` C ${pts[i].x + third} ${pts[i].y + tan[i] * third}, ${pts[i + 1].x - third} ${pts[i + 1].y - tan[i + 1] * third}, ${pts[i + 1].x} ${pts[i + 1].y}`;
  }
  return d;
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", paddingBottom: sp[4] },
  switch: { flexDirection: "row", gap: 2, padding: 3, borderRadius: radius.md, marginHorizontal: sp[4], marginTop: sp[4], marginBottom: sp[3] },
  // Each as wide as its word needs and the room shared out from there, so "Fortnightly" is never the one cut short.
  span: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", minWidth: 0, alignItems: "center", justifyContent: "center", minHeight: 36, paddingHorizontal: 6, borderRadius: radius.md - 3 },
  spanOn: { shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  kicker: { fontSize: 14, fontWeight: "500", paddingHorizontal: sp[5] },
  amountRow: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingHorizontal: sp[5] },
  amount: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, flexShrink: 1, fontVariant: ["tabular-nums"] },
  change: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill },
  legend: { flexDirection: "row", gap: sp[4], paddingHorizontal: sp[5], marginTop: sp[2] },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bubble: { position: "absolute", top: 4, height: 34, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  tail: { position: "absolute", top: 32, width: 10, height: 10, borderRadius: 2, transform: [{ rotate: "45deg" }] },
  caption: { fontSize: 13, textAlign: "center", paddingHorizontal: sp[4], marginTop: sp[2] },
  pills: { flexDirection: "row", paddingHorizontal: SIDE, marginTop: sp[3] },
  pill: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 14, fontWeight: "600", paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, overflow: "hidden" },
  pillDense: { fontSize: 12, paddingVertical: 7 },
});
