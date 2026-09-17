/**
 * The pieces TimeSheet's screens share, drawn as the site draws them: the
 * status pill, a workplace's swatch, a ledger of figures, the limit bar, one
 * shift in a list, a field for a date and time, and a row of choices.
 */
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import type { CashTally as CashTallyType, Choice, LimitCard, ShiftRow as ShiftRowType, ShiftStatus } from "@/api";

import { Card, Chip } from "./index";
import { tick } from "./haptics";
import { nativeOrNull } from "./native";
import { alpha, radius, sp, useTheme } from "./theme";

/** The phone's picker, looked up once; `null` in a build made before it was added. */
let picker: typeof import("@react-native-community/datetimepicker").default | null | undefined;
function DatePicker() {
  if (picker === undefined) picker = Platform.OS === "web" ? null : nativeOrNull(() => require("@react-native-community/datetimepicker").default);
  return picker;
}

// ---- small marks -------------------------------------------------------------

export function statusInk(status: ShiftStatus | "IDLE", t: ReturnType<typeof useTheme>) {
  if (status === "WORKING") return { bg: t.brandSoft, ink: t.brand };
  if (status === "ON_BREAK") return { bg: t.warnSoft, ink: t.warn };
  return { bg: t.surface3, ink: t.muted };
}

export function StatusPill({ status, label, small }: { status: ShiftStatus | "IDLE"; label: string; small?: boolean }) {
  const t = useTheme();
  const { bg, ink } = statusInk(status, t);
  return (
    <View style={[styles.pill, small && styles.pillSm, { backgroundColor: bg }]}>
      <View style={[styles.pillDot, { backgroundColor: ink }]} />
      <Text style={{ color: ink, fontSize: small ? 10.5 : 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

export function Swatch({ css, size = 10 }: { css: string | null | undefined; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: css || "hsl(220, 8%, 58%)" }} />;
}

/** "hsl(212 62% 50%)" from the server is CSS Color 4; React Native wants commas. */
export function cssColour(css: string | null | undefined): string {
  if (!css) return "hsl(220, 8%, 58%)";
  return css.replace(/hsl\(\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\s*\)/, "hsl($1, $2, $3)");
}

/**
 * The same colour, faint — the wash a workplace's own hue sits on.
 *
 * theme.ts's alpha() cannot do this: a workplace's colour arrives as hsl()
 * and is a different hue for every job, where the theme's are hexes fixed at
 * build time.
 */
export function hslAlpha(css: string, a: number): string {
  return css.replace(/^hsl\((.*)\)$/, `hsla($1, ${a})`);
}

// ---- figures -----------------------------------------------------------------

export function Ledger({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 2 }}>{children}</View>;
}

export function LedgerRow({ label, value, kind = "plain", minus }: { label: string; value: string; kind?: "plain" | "total" | "faint"; minus?: boolean }) {
  const t = useTheme();
  const total = kind === "total", faint = kind === "faint";
  return (
    <View style={[styles.ledgerRow, total && { borderTopWidth: 2, borderTopColor: t.line, marginTop: sp[2], paddingTop: sp[3] }]}>
      <Text style={{ color: faint ? t.muted : t.text, fontSize: total ? 17 : faint ? 13 : 15.5, fontWeight: total ? "700" : "400" }}>{label}</Text>
      <Text style={{ color: minus ? t.warn : total ? t.brand : faint ? t.muted : t.text, fontSize: total ? 20 : faint ? 13 : 15.5, fontWeight: total ? "700" : "600", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

export function Rule() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: sp[3] }} />;
}

/** How one workplace is tracking against its own cap (_limit_bar.html). */
export function LimitBar({ limit }: { limit: LimitCard }) {
  const t = useTheme();
  const router = useRouter();
  const ink = limit.state === "over" ? t.danger : limit.state === "close" ? t.warn : t.brand;
  return (
    <Card style={limit.state === "over" ? { borderWidth: 1.5, borderColor: alpha(t.danger, 0.4) } : undefined}>
      <View style={styles.limitHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.sectionLabel, { color: t.muted }]}>{limit.workplace.name} · this {limit.period_label}</Text>
          <Text style={{ marginTop: 2 }}>
            <Text style={{ color: t.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>{limit.since.hm}</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>  {limit.paid_at ? "since you were paid" : `/ ${limit.cap.hm}`}</Text>
          </Text>
        </View>
        <Pressable onPress={() => router.push(`/workplaces/${limit.workplace.id}/edit`)} hitSlop={8}>
          <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14 }}>Change</Text>
        </Pressable>
      </View>
      <View style={[styles.track, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
        <View style={[styles.fill, { width: `${Math.min(limit.settled_percent + limit.since_percent, 100)}%`, backgroundColor: ink }]} />
        {limit.settled_percent ? (
          <View style={[styles.fill, { width: `${limit.settled_percent}%`, backgroundColor: t.surface3 }]}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(ink, 0.3), borderRadius: 5 }]} />
          </View>
        ) : null}
      </View>
      <Text style={{ color: limit.state === "ok" ? t.muted : ink, fontSize: 13, fontWeight: limit.state === "ok" ? "400" : "600", marginTop: sp[2] }}>
        {limit.state === "over" ? `${limit.over.hm} over your limit at ${limit.workplace.name}` : limit.state === "close" ? `Only ${limit.remaining.hm} remaining` : `${limit.remaining.hm} remaining`}
        <Text style={{ color: t.muted, fontWeight: "400" }}> · {limit.period}, resets {limit.resets_on}</Text>
      </Text>
      {limit.paid_at ? (
        <Text style={{ color: t.muted, fontSize: 12.5, lineHeight: 18, marginTop: sp[2] }}>
          Counting again from your payment on {limit.paid_at}. The {limit.settled.hm} before it still counts toward this {limit.period_label}’s {limit.cap.hm} — {limit.used.hm} used so far.
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * A cash job with no cap, in the bar's place: the hours not yet paid for.
 *
 * There is no cycle to count over and no cap to fill, so there is no bar to
 * draw — only the figure the payment button clears, which is the whole of how
 * a job paid in hand is kept track of.
 */
export function CashTallyCard({ tally }: { tally: CashTallyType }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Card>
      <View style={styles.limitHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.sectionLabel, { color: t.muted }]}>{tally.workplace.name} · cash in hand</Text>
          <Text style={{ marginTop: 2 }}>
            <Text style={{ color: t.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.5 }}>{tally.total.hm}</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>  {tally.label.toLowerCase()}</Text>
          </Text>
        </View>
        <Pressable onPress={() => router.push("/pay")} hitSlop={8}>
          <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14 }}>Pay</Text>
        </Pressable>
      </View>
      <Text style={{ color: t.muted, fontSize: 13, marginTop: sp[2] }}>
        {tally.sub}
        {tally.pay ? <Text style={{ color: t.brand, fontWeight: "700" }}>  ·  ${tally.pay.net.toFixed(2)}</Text> : null}
      </Text>
    </Card>
  );
}

// ---- one shift in a list ---------------------------------------------------------

export function ShiftRow({ shift, count, last }: { shift: ShiftRowType; count: number; last?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const bar = shift.status === "WORKING" ? t.brand : shift.status === "ON_BREAK" ? t.warn : alpha(t.brand, 0.45);
  return (
    <>
      {shift.gap_before ? (
        <View style={styles.gap}>
          <View style={[styles.gapRule, { backgroundColor: t.line }]} />
          <Text style={{ color: t.muted, fontSize: 12 }}>{shift.gap_before.hm} off</Text>
          <View style={[styles.gapRule, { backgroundColor: t.line }]} />
        </View>
      ) : null}
      <Pressable onPress={() => router.push(`/shifts/${shift.id}`)} style={({ pressed }) => [styles.shift, { backgroundColor: pressed ? t.surface2 : "transparent", borderBottomColor: t.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]} testID={`shift-${shift.id}`}>
        <View style={[styles.bar, { backgroundColor: bar }]} />
        {count > 1 && shift.seq ? (
          <View style={[styles.seq, { backgroundColor: cssColour(shift.workplace?.css) }]}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{shift.seq}</Text></View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
            <Swatch css={cssColour(shift.workplace?.css)} />
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{shift.workplace?.name || ""}</Text>
            {shift.is_open ? <StatusPill status={shift.status} label={shift.status_label} small /> : null}
          </View>
          <Text style={{ color: t.text2, fontSize: 13.5 }}>
            {shift.in_at} <Text style={{ color: t.muted }}>→</Text> {shift.out_at || "now"}
            {shift.total_break.seconds ? <Text style={{ color: t.muted }}> · {shift.total_break.minutes} break</Text> : null}
          </Text>
        </View>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 15, fontVariant: ["tabular-nums"] }}>{shift.worked.hm}</Text>
        <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
      </Pressable>
    </>
  );
}

// ---- fields ------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
/** A Date as the form's "YYYY-MM-DDTHH:MM", in the phone's own zone. */
export function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseStamp(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
const words = (d: Date) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * A date and a time: the phone's own pickers where it has them, a typed
 * box on the web build. Empty is allowed where the site allows it (a
 * clock-out that is still running).
 */
export function DateTimeField({ value, onChange, placeholder, testID, invalid }: { value: string; onChange: (v: string) => void; placeholder?: string; testID?: string; invalid?: boolean }) {
  const t = useTheme();
  const [show, setShow] = useState<null | "date" | "time">(null);
  const parsed = parseStamp(value);
  const DateTimePicker = DatePicker();

  if (!DateTimePicker) {
    return (
      <TextInput
        value={value.replace("T", " ")}
        onChangeText={(v) => onChange(v.trim())}
        placeholder={placeholder || "YYYY-MM-DD HH:MM"}
        placeholderTextColor={t.muted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
        style={[styles.input, { backgroundColor: t.dark ? t.surface3 : t.surface2, borderColor: invalid ? t.danger : "transparent", color: t.text }]}
      />
    );
  }

  const pickerValue = parsed || new Date();
  return (
    <View style={{ gap: sp[2] }}>
      <View style={{ flexDirection: "row", gap: sp[2] }}>
        <Pressable onPress={() => setShow("date")} style={[styles.input, styles.pickBtn, { backgroundColor: t.dark ? t.surface3 : t.surface2, borderColor: invalid ? t.danger : "transparent" }]} testID={testID}>
          <Ionicons name="calendar-outline" size={18} color={t.muted} />
          <Text style={{ color: parsed ? t.text : t.muted, fontSize: 16 }}>{parsed ? parsed.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : placeholder || "Pick a day"}</Text>
        </Pressable>
        <Pressable onPress={() => setShow("time")} style={[styles.input, styles.pickBtn, { backgroundColor: t.dark ? t.surface3 : t.surface2, borderColor: invalid ? t.danger : "transparent", flex: 0, minWidth: 110 }]}>
          <Ionicons name="time-outline" size={18} color={t.muted} />
          <Text style={{ color: parsed ? t.text : t.muted, fontSize: 16 }}>{parsed ? parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"}</Text>
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange("")} hitSlop={8} style={{ justifyContent: "center" }} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={22} color={t.muted} />
          </Pressable>
        ) : null}
      </View>
      {show ? (
        <DateTimePicker
          value={pickerValue}
          mode={show}
          display={Platform.OS === "ios" ? (show === "date" ? "inline" : "spinner") : "default"}
          onChange={(event, picked) => {
            if (Platform.OS !== "ios") setShow(null);
            if (event.type === "dismissed" || !picked) return;
            const next = new Date(pickerValue);
            if (show === "date") next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
            else next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
            onChange(localStamp(next));
          }}
          themeVariant={t.dark ? "dark" : "light"}
          accentColor={t.brand}
        />
      ) : null}
      {show && Platform.OS === "ios" ? (
        <Pressable onPress={() => setShow(null)} style={{ alignSelf: "flex-end", paddingVertical: 4 }}>
          <Text style={{ color: t.brand, fontWeight: "700" }}>Done</Text>
        </Pressable>
      ) : null}
      {parsed ? <Text style={{ color: t.muted, fontSize: 12 }}>{words(parsed)}</Text> : null}
    </View>
  );
}

/** One answer from a few — the site's <select>, as chips a thumb can hit. */
export function Choices<T extends string | number>({ value, onChange, options, style }: { value: T | ""; onChange: (v: T) => void; options: Choice<T>[]; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }, style]}>
      {options.map((o) => <Chip key={String(o.value)} on={o.value === value} onPress={() => onChange(o.value)}>{o.label}</Chip>)}
    </View>
  );
}

/** The site's switch: a track the knob slides along. */
export function Switch({ value, onChange, label, danger }: { value: boolean; onChange: (v: boolean) => void; label: string; danger?: boolean }) {
  const t = useTheme();
  const on = danger ? t.danger : t.brand;
  return (
    <Pressable onPress={() => { tick(); onChange(!value); }} accessibilityRole="switch" accessibilityState={{ checked: value }} style={styles.switchRow}>
      <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{label}</Text>
      <View style={[styles.switchTrack, { backgroundColor: value ? on : t.track }]}>
        <View style={[styles.switchKnob, { backgroundColor: value ? "#fff" : t.knob, transform: [{ translateX: value ? 20 : 0 }] }]} />
      </View>
    </Pressable>
  );
}

export const sectionLabelStyle = { fontSize: 13.5, fontWeight: "700" as const, letterSpacing: -0.1 };

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, alignSelf: "flex-start" },
  pillSm: { paddingHorizontal: 8, paddingVertical: 3 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  ledgerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[3], paddingVertical: 6 },
  sectionLabel: sectionLabelStyle,
  limitHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: sp[3], marginBottom: sp[3] },
  track: { height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  gap: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingVertical: 4, paddingHorizontal: sp[4] },
  gapRule: { flex: 1, height: StyleSheet.hairlineWidth },
  shift: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingRight: sp[3], paddingLeft: sp[3], minHeight: 66 },
  bar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  seq: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  input: { minHeight: 52, paddingHorizontal: sp[4], paddingVertical: 13, borderRadius: radius.md, borderWidth: 1.5, fontSize: 16 },
  pickBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: sp[2] },
  switchRow: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[2] },
  switchTrack: { width: 50, height: 30, borderRadius: 15, padding: 3 },
  switchKnob: { width: 24, height: 24, borderRadius: 12, shadowColor: "#0f172a", shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
});
