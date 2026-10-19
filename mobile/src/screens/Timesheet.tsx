import { WorkPage } from "@/ui/WorkPage";
/**
 * The timesheet, kept to what you came for: one card with this period's pay
 * (its working-out a tap away), then the shifts — the week being read a day
 * at a time, and every week behind it folded into one row saying how long.
 * List or Calendar and "add a past shift" are icons beside the title. The
 * caps are the clock's, not this page's.
 */
import { WorkNavigation } from "@/ui/WorkNavigation";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";

import { useTimesheet, type Summary, type TimesheetDay, type TimesheetWeek } from "@/api";
import { Button, Card, Empty, ErrorBanner, Screen, useLayout, usePullRefresh } from "@/ui";
import { ChoiceRail } from "@/ui/ChoiceRail";
import { SkeletonTimesheet } from "@/ui/Skeleton";
import { sp, useTheme } from "@/ui/theme";
import { tick } from "@/ui/haptics";
import { cssColour, Ledger, LedgerRow, ShiftRow } from "@/ui/timesheet";
import { CalendarView } from "@/ui/CalendarView";
import { TrendChart } from "@/ui/TrendChart";
import { Split } from "@/ui/Split";
import { joinWeeks, weekLabel } from "@/ui/weeks";
import { Fold, FoldChevron } from "@/ui/Disclosure";
import { useComeUp } from "@/ui/depth";

export default function Timesheet() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const [workplace, setWorkplace] = useState<number | null>(null);
  // List or Calendar are two faces of one screen, not two screens. A link in
  // from outside (`/timesheet/calendar` on the site) arrives asking for one.
  const asked = useLocalSearchParams<{ view?: string }>().view;
  const [view, setView] = useState<"list" | "calendar">(asked === "calendar" ? "calendar" : "list");
  // A link arriving while this screen is already up changes the params without
  // building it again, so the ask has to be followed as well as read.
  useEffect(() => { if (asked === "calendar") setView("calendar"); }, [asked]);
  const q = useTimesheet(workplace);
  const client = useQueryClient();
  const refresh = usePullRefresh(() => Promise.all([q.refetch(), client.invalidateQueries({ queryKey: ["trend"] })]));
  const first = q.data?.pages[0];
  const days = q.data?.pages.flatMap((p) => p.days) ?? [];
  const weeks = joinWeeks(q.data?.pages.flatMap((p) => p.weeks ?? []) ?? []);
  const calendar = view === "calendar";
  // Everything under the chart starts shut, and only one day or week is open
  // at a time: opening another folds the last one away.
  const [opened, setOpened] = useState<string | null>(null);
  const fold = (key: string) => ({ open: opened === key, onToggle: () => { tick(); setOpened((was) => (was === key ? null : key)); } });

  return (
    <Screen section="Work">
      <WorkPage refreshControl={calendar ? undefined : refresh} wide={!calendar}>
        <WorkNavigation active="timesheet" wide={!calendar} />
        {/* The two things to do here sit beside the title as icons, rather
            than as two full-width rows above the figures they push down. */}
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>Timesheets</Text>
          <HeadButton icon={calendar ? "list-outline" : "calendar-outline"} label={calendar ? "Show list" : "Show calendar"} on={calendar} onPress={() => setView(calendar ? "list" : "calendar")} testID="timesheet-view" />
          <HeadButton icon="add" label="Add a past shift" onPress={() => router.push("/shifts/new")} testID="timesheet-add" />
        </View>
        {calendar ? <CalendarView /> : (
          <>
          {first && first.workplaces.length > 1 ? (
            <ChoiceRail label="Timesheet workplace" bleed={layout.desk ? 0 : layout.column.paddingLeft as number} value={workplace === null ? "all" : String(workplace)} onChange={value => setWorkplace(value === "all" ? null : Number(value))}
              options={[{ value: "all", label: "All" }, ...first.workplaces.map(w => ({ value: String(w.id), label: w.name, dot: cssColour(w.css) }))]} />
          ) : null}
          {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
          {q.isLoading ? <SkeletonTimesheet /> : null}
          {/* On a wide screen the figures and the shifts sit side by side. */}
          <Split
            main={<>
              {first ? <SummaryBlock summary={first.summary} /> : null}
              {first ? <TrendChart workplace={workplace} testID="timesheet-trend" /> : null}
            </>}
            side={<>
            {days.length ? <View style={{ gap: sp[2] }}>{days.map((day) => <Day key={day.date} day={day} {...fold(`day:${day.date}`)} />)}</View> : null}
            {weeks.length ? (
              <View style={{ gap: sp[2] }}>
                <Text style={[styles.section, { color: t.muted }]}>Earlier</Text>
                <Card pad={false} style={{ overflow: "hidden" }}>
                  {weeks.map((week, i) => <Week key={week.start} week={week} last={i === weeks.length - 1} {...fold(`week:${week.start}`)} />)}
                </Card>
              </View>
            ) : null}
            {!days.length && !weeks.length && first ? (
              <Empty
                icon="time-outline"
                title="No shifts yet"
                sub={workplace ? `Nothing recorded for ${first.workplaces.find((w) => w.id === workplace)?.name}.` : "Clock in to start your first one."}
                action={<Button title="Go to the clock" onPress={() => router.navigate("/clock")} />}
              />
            ) : null}
            {q.hasNextPage ? <Button title={q.isFetchingNextPage ? "Loading…" : "Older shifts"} kind="ghost" onPress={() => q.fetchNextPage()} busy={q.isFetchingNextPage} /> : null}
            </>}
          />
          </>
        )}
      </WorkPage>
    </Screen>
  );
}

function HeadButton({ icon, label, on, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; on?: boolean; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} hitSlop={4} onPress={() => { tick(); onPress(); }} testID={testID}
      style={({ pressed }) => [styles.round, { backgroundColor: on ? t.text : t.dark ? t.surface2 : t.surface, borderColor: on ? t.text : t.line, opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={20} color={on ? t.bg : t.text2} />
    </Pressable>
  );
}

/**
 * The period you are paid by, as one card: the figure you came for, how
 * long it took, and the other running totals in a line beneath. How that
 * figure was worked out — gross, tax, the note — opens on a tap.
 */
export function SummaryBlock({ summary }: { summary: Summary }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { period } = summary;
  const pay = period.pay;
  const others = summary.cards.filter((card) => card.key !== period.key);
  const kind = pay ? (pay.withheld ? "take-home" : pay.cash ? "cash in hand" : "before tax") : "worked";
  return (
    <Card pad={false} style={{ overflow: "hidden" }} testID="timesheet-summary">
      <View style={{ padding: sp[5], gap: sp[1] }}>
        <View style={styles.between}>
          <Text style={{ color: t.text2, fontSize: 14, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>{periodName(period.title)}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{period.dates}</Text>
        </View>
        <Text style={[styles.big, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{pay ? `$${pay.pay.net.toFixed(2)}` : period.total.hm}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {pay ? `${kind} · ${period.total.hm}` : kind}
          {others.map((card) => ` · ${card.label.toLowerCase()} ${card.total.hm}`).join("")}
        </Text>
      </View>
      {pay ? (
        <>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((v) => !v)} testID="timesheet-pay-details"
            style={({ pressed }) => [styles.more, { borderTopColor: t.line, backgroundColor: pressed ? t.surface2 : "transparent" }]}>
            <Text style={{ color: t.text2, fontSize: 14, fontWeight: "600" }}>{open ? "Hide breakdown" : "Pay breakdown"}</Text>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.muted} />
          </Pressable>
          {open ? (
            <View style={{ paddingHorizontal: sp[5], paddingBottom: sp[5] }}>
              <Ledger>
                <LedgerRow label="Hours worked" value={period.total.decimal} />
                <LedgerRow label="Gross earnings" value={`$${pay.pay.gross.toFixed(2)}`} />
                {pay.withheld ? <LedgerRow label="Tax withheld" value={`−$${pay.pay.tax.toFixed(2)}`} minus /> : null}
                <LedgerRow label={pay.withheld ? "Take-home" : "Total"} value={`$${pay.pay.net.toFixed(2)}`} kind="total" />
              </Ledger>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginTop: sp[3] }}>
                {pay.cash
                  ? "Cash in hand — no tax comes out."
                  : !pay.withheld
                    ? "Before tax. Set your tax situation on the workplace to see take-home."
                    : "Estimated with the ATO’s 2026–27 withholding formulas — check it against your payslip."}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {/* The caps live on the clock, where you want them before pressing the
          button. One per capped workplace here pushed the shifts off screen. */}
    </Card>
  );
}

/** "This fortnight’s pay" reads as "This fortnight" above a figure that is plainly the pay. */
function periodName(title: string) {
  return title.replace(/[’']s pay$/i, "");
}

/** A week behind the one being read: shut, saying only how long it was, until it is opened. */
function Week({ week, last, open, onToggle }: { week: TimesheetWeek; last?: boolean; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  // Inside an open week, its days keep to one at a time too.
  const [day, setDay] = useState<string | null>(null);
  const root = useComeUp(open);
  return (
    <View ref={root} style={!last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.weekHead, { backgroundColor: pressed ? t.surface2 : "transparent" }]}
        testID={`week-${week.start}`}
      >
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 15, flex: 1 }} numberOfLines={1}>{weekLabel(week)}</Text>
        <Text style={{ color: t.text2, fontWeight: "600", fontSize: 15, fontVariant: ["tabular-nums"] }}>{week.total.hm}</Text>
        <FoldChevron open={open} size={16} colour={t.muted} />
      </Pressable>
      <Fold open={open} style={[styles.weekDays, { backgroundColor: t.dark ? t.bg : t.surface2 }]}>
        {week.days.map((d) => (
          <Day key={d.date} day={d} open={open && day === d.date} onToggle={() => { tick(); setDay((was) => (was === d.date ? null : d.date)); }} />
        ))}
      </Fold>
    </View>
  );
}

function Day({ day, open, onToggle }: { day: TimesheetDay; open: boolean; onToggle: () => void }) {
  const t = useTheme();
  const n = day.shifts.length;
  const root = useComeUp(open);
  return (
    <View ref={root}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.dayHead} testID={`day-${day.date}`}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>{day.label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
          <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14, fontVariant: ["tabular-nums"] }}>{day.total.hm}</Text>
          <FoldChevron open={open} colour={t.muted} />
        </View>
      </Pressable>
      <Fold open={open} style={{ paddingBottom: sp[2] }}>
        <Card pad={false}>
          {day.shifts.map((s, i) => <ShiftRow key={s.id} shift={s} count={n} last={i === n - 1} />)}
        </Card>
      </Fold>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  title: { flex: 1, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  between: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: sp[3] },
  big: { fontSize: 38, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, paddingHorizontal: sp[5], borderTopWidth: StyleSheet.hairlineWidth },
  section: { fontSize: 13, fontWeight: "600", paddingHorizontal: sp[1] },
  dayHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: sp[1] },
  weekHead: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 52, paddingHorizontal: sp[4] },
  // Stepped in on a quieter ground, so a day's head inside is never taken for a week's.
  weekDays: { paddingHorizontal: sp[3], paddingBottom: sp[3] },
});
