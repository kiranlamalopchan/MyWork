/**
 * Pay, one workplace at a time: swipe the cards to pick a job, then everything
 * below — the payment button, what is unpaid, the last payment — is that job's
 * alone. Kept to one number per card and one action per job.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, usePay, useTimesheetChanged, type PayRow, type PayRun } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, Input, Screen, useLayout } from "@/ui";
import { WorkPage } from "@/ui/WorkPage";
import { WorkNavigation } from "@/ui/WorkNavigation";
import { SkeletonPay } from "@/ui/Skeleton";
import { confirm, notify, tell } from "@/ui/confirm";
import { radius, sp, useTheme } from "@/ui/theme";
import { Frost } from "@/ui/Frost";
import { Split } from "@/ui/Split";
import { Choices } from "@/ui/timesheet";
import { success, tick } from "@/ui/haptics";
import { useReducedMotion } from "@/ui/useReducedMotion";

const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GAP = 12;

export default function Pay() {
  const t = useTheme(), router = useRouter(), q = usePay();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rows = q.data?.owing ?? [];
  const selected = rows.find(row => row.workplace.id === selectedId) || rows.find(row => row.workplace.is_default) || rows[0];
  return <Screen section="Work"><WorkPage wide>
    <WorkNavigation active="pay" wide />
    <View style={styles.pageHead}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>Pay</Text>
        {rows.length > 1 && q.data ? <Text style={{ color: t.muted, fontSize: 14 }}>{q.data.owed_total.hm} unpaid across {rows.length} workplaces</Text> : null}
      </View>
      {selected ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${selected.workplace.name} pay settings`} hitSlop={6} onPress={() => router.push(`/workplaces/${selected.workplace.id}/edit`)}
        style={({ pressed }) => [styles.round, { backgroundColor: t.dark ? t.surface2 : t.surface, borderColor: t.line, opacity: pressed ? .7 : 1 }]}>
        <Ionicons name="options-outline" size={20} color={t.text2} />
      </Pressable> : null}
    </View>
    {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
    {q.isLoading ? <SkeletonPay /> : null}
    {q.data && !rows.length ? <Empty icon="wallet-outline" title="Your pay starts here" sub="Add a workplace to keep its hours and payments together." action={<Button title="Add a workplace" onPress={() => router.push("/workplaces/new")} />} /> : null}
    {/* The earnings chart lives on Timesheets only. On an iPad the chosen job's details sit beside the cards. */}
    {q.data && selected ? <Split
      main={<WorkplaceCards rows={rows} selectedId={selected.workplace.id} onSelect={setSelectedId} />}
      side={<PaymentDetails key={`${selected.workplace.id}:${selected.covers.map(c => c.value).join("|")}:${selected.last_payment?.covers_through || ""}`} row={selected} today={q.data.today} />}
    /> : null}
  </WorkPage></Screen>;
}

/**
 * The workplaces as a wallet of bank cards. The chosen card sits centred and
 * sharp; its neighbours peek in at the screen's edges, smaller and frosted,
 * and come into focus as they are swiped to. The row bleeds through the page
 * gutter so the peeks reach the edge of the screen rather than being clipped
 * by it.
 */
function WorkplaceCards({ rows, selectedId, onSelect }: { rows: PayRow[]; selectedId: number; onSelect: (id: number) => void }) {
  const t = useTheme(), scroll = useRef<ScrollView>(null), reduced = useReducedMotion(), layout = useLayout();
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null), dragging = useRef(false);
  const x = useRef(new Animated.Value(0)).current;
  const [full, setFull] = useState(layout.width);
  const index = Math.max(0, rows.findIndex(row => row.workplace.id === selectedId));
  const many = rows.length > 1;
  const cardWidth = Math.min(Math.max(240, full - 72), 420), cardHeight = Math.round(Math.min(Math.max(cardWidth / 1.586, 176), 250));
  const side = Math.max(0, (full - cardWidth) / 2), interval = cardWidth + GAP;
  useEffect(() => { scroll.current?.scrollTo({ x: index * interval, animated: !reduced }); }, [index, interval, reduced]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);
  const choose = (next: number) => { if (next >= 0 && next < rows.length && next !== index) { tick(); onSelect(rows[next].workplace.id); } };
  const land = (offset: number) => {
    if (settle.current) clearTimeout(settle.current);
    const next = Math.max(0, Math.min(Math.round(offset / interval), rows.length - 1));
    choose(next);
  };
  const onScroll = Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
    useNativeDriver: true,
    listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // A slow drag ends with no momentum event, so
      // settle once the scrolling stops — but never under a resting finger.
      const offset = event.nativeEvent.contentOffset.x;
      if (settle.current) clearTimeout(settle.current);
      if (!dragging.current) settle.current = setTimeout(() => land(offset), 140);
    },
  });
  return <View style={{ gap: sp[1] }}>
    {/* On a phone the row runs to the screen's edges; in a desktop column it stays inside its own. */}
    <View style={{ marginHorizontal: layout.desk ? 0 : -(layout.column.paddingLeft as number), overflow: layout.desk ? "hidden" : "visible", borderRadius: layout.desk ? 20 : 0 }} onLayout={event => setFull(Math.max(1, Math.floor(event.nativeEvent.layout.width)))}>
      <Animated.ScrollView ref={scroll} horizontal scrollEnabled={many} accessibilityLabel="Workplace pay cards" accessibilityHint={many ? "Swipe left or right to switch workplaces" : undefined} testID="pay-workplace-carousel"
        showsHorizontalScrollIndicator={false} directionalLockEnabled nestedScrollEnabled
        decelerationRate="fast" snapToInterval={interval} snapToAlignment="start" disableIntervalMomentum
        contentContainerStyle={{ gap: GAP, paddingHorizontal: side, paddingVertical: sp[3] }}
        onScrollBeginDrag={() => { dragging.current = true; }}
        onScrollEndDrag={() => { dragging.current = false; }}
        onMomentumScrollEnd={event => land(event.nativeEvent.contentOffset.x)}
        onScroll={onScroll} scrollEventThrottle={16}>
        {rows.map((row, i) => {
          const range = [(i - 1) * interval, i * interval, (i + 1) * interval];
          const scale = x.interpolate({ inputRange: range, outputRange: [0.9, 1, 0.9], extrapolate: "clamp" });
          const frost = x.interpolate({ inputRange: range, outputRange: [1, 0, 1], extrapolate: "clamp" });
          return <Animated.View key={row.workplace.id} style={{ width: cardWidth, height: cardHeight, transform: [{ scale }] }}>
            <WorkplaceCard row={row} width={cardWidth} height={cardHeight} selected={i === index} onPress={() => choose(i)} />
            {many ? <Frost opacity={frost} radius={20} /> : null}
          </Animated.View>;
        })}
      </Animated.ScrollView>
    </View>
    {many ? <View style={styles.pager}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous workplace" disabled={index === 0} onPress={() => choose(index - 1)} style={[styles.arrow, { opacity: index === 0 ? .3 : 1 }]}><Ionicons name="chevron-back" size={18} color={t.text2} /></Pressable>
      <View style={styles.dots} accessibilityLiveRegion="polite">
        {rows.length <= 5 ? rows.map((row, i) => <Pressable key={row.workplace.id} accessibilityRole="button" accessibilityLabel={`Show ${row.workplace.name}`} accessibilityState={{ selected: i === index }} onPress={() => choose(i)} style={styles.dotTarget}>
          <View style={[styles.dot, { width: i === index ? 18 : 6, backgroundColor: i === index ? cardInk(row.workplace.hue) : t.lineStrong }]} />
        </Pressable>) : <Text style={{ color: t.muted, fontSize: 13 }}>{index + 1} of {rows.length}</Text>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Next workplace" disabled={index === rows.length - 1} onPress={() => choose(index + 1)} style={[styles.arrow, { opacity: index === rows.length - 1 ? .3 : 1 }]}><Ionicons name="chevron-forward" size={18} color={t.text2} /></Pressable>
    </View> : null}
  </View>;
}

/** Each job keeps its own colour, deepened into a card: dark at one corner, bright at the other. */
const cardInk = (hue: number | null | undefined) => `hsl(${(hue ?? 270) % 360}, 62%, 42%)`;
function cardPaint(hue: number | null | undefined) {
  const h = hue ?? 270;
  return { from: `hsl(${h % 360}, 70%, 20%)`, mid: `hsl(${(h + 25) % 360}, 68%, 34%)`, to: `hsl(${(h + 50) % 360}, 75%, 50%)` };
}

/**
 * The card's chip, drawn the way a real EMV chip's contacts are laid out: a
 * rounded pad down the middle with three contacts running out to each edge,
 * on brushed gold. Its gradient id is its own (useId), so two chips never
 * share a paint.
 */
function CardChip({ width = 44, height = 33 }: { width?: number; height?: number }) {
  const id = `chip-${React.useId()}`;
  const ink = "#9a7128";
  const line = { stroke: ink, strokeWidth: 0.9, strokeLinecap: "round" as const, fill: "none" };
  // In a 44 × 33 box: the pad sits from x 16 to 28; the contacts' seams at thirds of the height.
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Svg width={width} height={height} viewBox="0 0 44 33">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#f6dc94" />
          <Stop offset="0.45" stopColor="#e2b85e" />
          <Stop offset="1" stopColor="#c8963d" />
        </LinearGradient>
      </Defs>
      <Rect x={0.5} y={0.5} width={43} height={32} rx={6.5} fill={`url(#${id})`} stroke={ink} strokeWidth={0.9} />
      <Rect x={16} y={4.5} width={12} height={24} rx={6} {...line} />
      <Path d="M22 0.5 V4.5 M22 28.5 V32.5" {...line} />
      <Path d="M0.5 11.5 H16.4 M0.5 21.5 H16.4 M27.6 11.5 H43.5 M27.6 21.5 H43.5" {...line} />
      <Path d="M0.5 16.5 H16 M28 16.5 H43.5" {...line} />
    </Svg>
    </View>
  );
}

/**
 * One workplace as a bank card: what kind of pay up top, the chip, the figure
 * owed written large where the card number goes, and the job and its hours
 * where the holder's name and expiry go.
 */
function WorkplaceCard({ row, width, height, selected, onPress }: { row: PayRow; width: number; height: number; selected: boolean; onPress: () => void }) {
  const w = row.workplace, owed = !!row.worked.seconds, paint = cardPaint(w.hue), id = `pay-card-${React.useId().replace(/:/g, "")}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Select ${w.name}`} accessibilityState={{ selected }} onPress={onPress} testID={`pay-workplace-${w.id}`}
    style={[styles.card, { width, height, backgroundColor: paint.from, shadowColor: paint.mid }]}>
    <View style={[StyleSheet.absoluteFill, { borderRadius: 20, overflow: "hidden" }]} pointerEvents="none">
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={paint.from} /><Stop offset="0.55" stopColor={paint.mid} /><Stop offset="1" stopColor={paint.to} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        <Path d={`M 0 ${height * 0.62} C ${width * 0.3} ${height * 0.42}, ${width * 0.55} ${height * 0.95}, ${width} ${height * 0.55} L ${width} ${height} L 0 ${height} Z`} fill="#ffffff" opacity={0.07} />
        <Path d={`M 0 ${height * 0.8} C ${width * 0.35} ${height * 0.6}, ${width * 0.6} ${height * 1.05}, ${width} ${height * 0.75} L ${width} ${height} L 0 ${height} Z`} fill="#ffffff" opacity={0.06} />
        <Circle cx={width * 0.92} cy={height * 0.08} r={height * 0.55} fill="#ffffff" opacity={0.06} />
      </Svg>
    </View>
    <View style={styles.cardRow}>
      <Text style={styles.cardKicker} numberOfLines={1}>{row.scheduled ? `${row.cycle_label} pay` : row.cycle_label}</Text>
      <Text style={styles.cardMark}>{owed ? "UNPAID" : "PAID"}</Text>
    </View>
    <View style={styles.cardRow}>
      <CardChip />
      <Ionicons name="wifi" size={20} color="rgba(255,255,255,.85)" style={{ transform: [{ rotate: "90deg" }] }} />
    </View>
    <Text style={styles.cardNumber} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{row.owed_pay ? money(row.owed_pay.gross) : row.worked.hm}</Text>
    <View style={[styles.cardRow, { alignItems: "flex-end" }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.cardLabel}>WORKPLACE</Text>
        <Text style={styles.cardValue} numberOfLines={1}>{w.name}</Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={styles.cardLabel}>{owed ? (row.owed_pay ? "HOURS · BEFORE TAX" : "UNPAID") : "STATUS"}</Text>
        <Text style={styles.cardValue}>{owed ? `${row.worked.hm} · ${row.shifts} shift${row.shifts === 1 ? "" : "s"}` : "All clear"}</Text>
      </View>
    </View>
  </Pressable>;
}

function PaymentDetails({ row, today }: { row: PayRow; today: string }) {
  const t = useTheme(), changed = useTimesheetChanged(), router = useRouter();
  const [covers, setCovers] = useState(String(row.covers[0]?.value || "date")), [upTo, setUpTo] = useState(today);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const w = row.workplace, owed = !!row.worked.seconds;
  const chosen = covers === "date" ? `Work up to ${upTo}` : row.covers.find(c => String(c.value) === covers)?.label || "Everything so far";
  const settle = () => confirm(`Mark ${w.name} paid?`, `${chosen}. Only this workplace will be updated.`, "Payment received", async () => {
    setBusy(true);
    try {
      const page = await timesheet.recordPayment(w.id, covers, covers === "date" ? upTo : undefined);
      success(); changed(); setOpen(false);
      tell("Payment recorded", page.message || `${w.name}'s pay has been updated.`);
    } catch (e: any) { notify("Not recorded", e?.message || ""); }
    finally { setBusy(false); }
  }, false);
  const undo = () => confirm(`Undo the last payment at ${w.name}?`, "Those hours go back to being owed.", "Undo", async () => {
    setBusy(true);
    try { await timesheet.undoPayment(w.id); success(); changed(); }
    catch (e: any) { notify("Not undone", e?.message || ""); }
    finally { setBusy(false); }
  });
  const unpaid: { run: PayRun; title: string; sub: string; due: boolean }[] = [
    ...row.due.map(run => ({ run, title: run.dates || "Unpaid pay period", sub: run.payday ? `Due · payday ${run.payday}` : "Due", due: true })),
    ...(row.current && (row.scheduled || row.current.worked.seconds > 0) ? [{ run: row.current, title: row.current.dates || "Since the last payment", sub: row.current.payday ? `${row.current.payable ? "Payday" : "Next payday"} ${row.current.payday}` : `${row.shifts} shift${row.shifts === 1 ? "" : "s"}`, due: false }] : []),
  ];
  return <View testID={`pay-${w.id}`} style={{ gap: sp[5] }}>
    {owed ? <View style={{ gap: sp[3] }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose what this payment covers" accessibilityState={{ expanded: open }} disabled={busy} onPress={() => setOpen(value => !value)}
        style={[styles.covers, { backgroundColor: t.surface, borderColor: t.line }]} testID={`covers-${w.id}`}>
        <Text style={{ color: t.muted, fontSize: 14 }}>Covers</Text>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: "600", flex: 1, textAlign: "right" }} numberOfLines={1}>{chosen}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.muted} />
      </Pressable>
      {open ? <View style={{ gap: sp[3] }}>
        <Choices value={covers} onChange={setCovers} options={[...row.covers.map(c => ({ value: String(c.value), label: c.label })), { value: "date", label: "Choose a date" }]} />
        {covers === "date" ? <Field label="Paid up to and including"><Input accessibilityLabel="Paid up to and including" value={upTo} onChangeText={setUpTo} placeholder="YYYY-MM-DD" autoCapitalize="none" editable={!busy} /></Field> : null}
      </View> : null}
      <Button title="Payment received" icon="checkmark" onPress={settle} busy={busy} disabled={busy || (covers === "date" && !upTo)} testID={`settle-${w.id}`} />
      {!row.owed_pay ? <Button title="Add a pay rate" kind="ghost" size="sm" onPress={() => router.push(`/workplaces/${w.id}/edit`)} /> : null}
    </View> : null}
    {unpaid.length ? <Group title="Unpaid">
      {unpaid.map((item, i) => <Line key={`${item.run.end || "now"}-${i}`} title={item.title} sub={item.sub} warn={item.due}
        value={item.run.pay ? money(item.run.pay.gross) : `${item.run.hours.toFixed(1)}h`} note={item.run.pay ? `${item.run.hours.toFixed(1)}h` : undefined} last={i === unpaid.length - 1} />)}
    </Group> : null}
    {row.last_payment ? <Group title="Last payment">
      <View style={styles.line}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>Through {row.last_payment.covers_through}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>{row.last_payment.amount != null ? `${money(row.last_payment.amount)} · ` : ""}{row.last_payment.hours}h</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Undo last payment at ${w.name}`} disabled={busy} onPress={undo} hitSlop={8} style={({ pressed }) => [styles.undo, { backgroundColor: t.dark ? t.surface3 : t.surface2, opacity: pressed ? .7 : 1 }]}>
          <Text style={{ color: t.text2, fontSize: 13, fontWeight: "600" }}>Undo</Text>
        </Pressable>
      </View>
    </Group> : !owed ? <Text style={{ color: t.muted, fontSize: 14, textAlign: "center" }}>All clear — nothing owed at {w.name}.</Text> : null}
  </View>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ gap: sp[2] }}>
    <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600", paddingHorizontal: sp[1] }}>{title}</Text>
    <Card pad={false} style={{ overflow: "hidden" }}>{children}</Card>
  </View>;
}

function Line({ title, sub, value, note, warn, last }: { title: string; sub: string; value: string; note?: string; warn?: boolean; last?: boolean }) {
  const t = useTheme();
  return <View style={[styles.line, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }} numberOfLines={1}>{title}</Text>
      <Text style={{ color: warn ? t.warn : t.muted, fontSize: 13 }} numberOfLines={1}>{sub}</Text>
    </View>
    <View style={{ alignItems: "flex-end", gap: 2 }}>
      <Text style={{ color: t.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
      {note ? <Text style={{ color: t.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>{note}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  pageHead: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -.8 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: 20, padding: sp[5], justifyContent: "space-between", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[3] },
  cardKicker: { color: "rgba(255,255,255,.82)", fontSize: 11, fontWeight: "700", letterSpacing: 1.4, flexShrink: 1, textTransform: "uppercase" },
  cardMark: { color: "#ffffff", fontSize: 18, fontWeight: "900", fontStyle: "italic", letterSpacing: 0.5 },
  cardNumber: { color: "#ffffff", fontSize: 30, fontWeight: "700", letterSpacing: 2, fontVariant: ["tabular-nums"] },
  cardLabel: { color: "rgba(255,255,255,.7)", fontSize: 9, fontWeight: "700", letterSpacing: 1 },
  cardValue: { color: "#ffffff", fontSize: 13, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", alignItems: "center", justifyContent: "center", flex: 1 },
  dotTarget: { minWidth: 28, minHeight: 44, alignItems: "center", justifyContent: "center" },
  dot: { height: 6, borderRadius: 3 },
  covers: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 52, paddingHorizontal: sp[4], borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 60 },
  undo: { borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 32, justifyContent: "center" },
});
