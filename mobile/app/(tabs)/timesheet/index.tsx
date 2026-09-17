/**
 * The timesheet (templates/timeclock/timesheet.html): List or Calendar, a
 * chip per workplace to filter by, the period cards and the pay written
 * over the longest of them, then the shifts — the week being read written
 * out a day at a time, and every week behind it folded into one row that
 * says how many shifts and how long. The caps are the clock's, not this
 * page's.
 */
import React, { useEffect, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useTimesheet, type Summary, type TimesheetDay, type TimesheetWeek } from "@/api";
import { Button, Card, Chip, Empty, ErrorBanner, Page, PageTitle, Screen, Segments } from "@/ui";
import { SkeletonTimesheet } from "@/ui/Skeleton";
import { radius, sp, useTheme } from "@/ui/theme";
import { cssColour, Ledger, LedgerRow, ShiftRow } from "@/ui/timesheet";
import { CalendarView } from "@/ui/CalendarView";
import { joinWeeks, weekLabel } from "@/ui/weeks";

export default function Timesheet() {
  const t = useTheme();
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
  const first = q.data?.pages[0];
  const days = q.data?.pages.flatMap((p) => p.days) ?? [];
  const weeks = joinWeeks(q.data?.pages.flatMap((p) => p.weeks ?? []) ?? []);

  return (
    <Screen>
      <Page refreshControl={view === "list" ? <RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={q.refetch} tintColor={t.brand} /> : undefined}>
        <PageTitle>Timesheet</PageTitle>
        <Segments value={view} onChange={(v) => setView(v as "list" | "calendar")} options={[{ value: "list", label: "List" }, { value: "calendar", label: "Calendar" }]} />
        {view === "calendar" ? <CalendarView /> : (
          <>
          {first && first.workplaces.length ? (
            <View style={styles.chips}>
              <Chip on={workplace === null} onPress={() => setWorkplace(null)}>All</Chip>
              {first.workplaces.map((w) => (
                <Chip key={w.id} on={workplace === w.id} onPress={() => setWorkplace(w.id)} dot={cssColour(w.css)}>{w.name}</Chip>
              ))}
            </View>
          ) : null}
          {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
          {q.isLoading ? <SkeletonTimesheet /> : null}
          {first ? <SummaryBlock summary={first.summary} /> : null}
          {days.map((day) => <Day key={day.date} day={day} open />)}
          {weeks.map((week) => <Week key={week.start} week={week} />)}
          {!days.length && !weeks.length && first ? (
            <Empty
              icon="time-outline"
              title="No shifts yet"
              sub={workplace ? `Nothing recorded for ${first.workplaces.find((w) => w.id === workplace)?.name}.` : "Clock in to start your first one."}
              action={<Button title="Go to the clock" onPress={() => router.navigate("/clock")} />}
            />
          ) : null}
          {q.hasNextPage ? <Button title={q.isFetchingNextPage ? "Loading…" : "Older shifts"} kind="plain" onPress={() => q.fetchNextPage()} busy={q.isFetchingNextPage} /> : null}
          </>
        )}
      </Page>
    </Screen>
  );
}

export function SummaryBlock({ summary }: { summary: Summary }) {
  const t = useTheme();
  const { period } = summary;
  const pay = period.pay;
  return (
    <>
      <View style={styles.grid}>
        {summary.cards.map((card) => (
          <Card key={card.key} pad={false} style={[styles.summaryCard, summary.cards.length === 1 && { width: "100%" }]}>
            <Text style={[styles.label, { color: t.muted }]}>{card.label}</Text>
            <Text style={[styles.value, { color: t.text }]}>{card.total.hm}</Text>
            <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>{card.sub}</Text>
            {card.net !== null ? (
              <Text style={[styles.cardPay, { color: t.brand }]}>${card.net.toFixed(2)}</Text>
            ) : null}
          </Card>
        ))}
      </View>
      {pay ? (
        <Card pad={false} style={{ overflow: "hidden" }}>
          <View style={[styles.payHero, { backgroundColor: t.hero }]}>
            <View style={styles.payHead}>
              <Text style={{ color: t.heroSoft, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>{period.title}</Text>
              <Text style={{ color: t.heroSoft, fontSize: 13 }}>{period.dates}</Text>
            </View>
            <Text style={[styles.payBig, { color: t.heroInk }]}>${pay.pay.net.toFixed(2)}</Text>
            <Text style={{ color: t.heroSoft, fontSize: 14, fontWeight: "600" }}>{pay.withheld ? "Take-home" : pay.cash ? "Cash in hand" : "Before tax"} · {period.total.decimal} h</Text>
          </View>
          <View style={{ padding: sp[5], paddingTop: sp[4] }}>
          <Ledger>
            <LedgerRow label="Hours worked" value={period.total.decimal} />
            <LedgerRow label="Gross earnings" value={`$${pay.pay.gross.toFixed(2)}`} />
            {pay.withheld ? <LedgerRow label="Tax withheld" value={`−$${pay.pay.tax.toFixed(2)}`} minus /> : null}
            <LedgerRow label={pay.withheld ? "Take-home" : "Total"} value={`$${pay.pay.net.toFixed(2)}`} kind="total" />
          </Ledger>
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginTop: sp[3] }}>
            {pay.cash
              ? "Cash in hand — no tax comes out, so this is what you earned."
              : !pay.withheld
                ? "This is before tax. Add the percentage withheld on a payslip to your workplace and every figure here becomes take-home."
                : "Estimated from your hourly rate and withholding — check it against your payslip."}
          </Text>
          </View>
        </Card>
      ) : null}
      {/* The caps live on the clock, where you want them before pressing the
          button. One per capped workplace here pushed the shifts off screen. */}
    </>
  );
}

/** A week behind the one being read: shut, saying only what is inside it. */
function Week({ week }: { week: TimesheetWeek }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[styles.weekHead, { backgroundColor: t.surface, borderColor: t.line }]}
        testID={`week-${week.start}`}
      >
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>{weekLabel(week)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{week.shifts} shift{week.shifts === 1 ? "" : "s"}</Text>
          <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14, fontVariant: ["tabular-nums"] }}>{week.total.hm}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.weekDays}>
          {week.days.map((day) => <Day key={day.date} day={day} open={false} />)}
        </View>
      ) : null}
    </View>
  );
}

function Day({ day, open: initially }: { day: TimesheetDay; open: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(initially);
  const n = day.shifts.length;
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.dayHead} testID={`day-${day.date}`}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{day.label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{n} shift{n === 1 ? "" : "s"}</Text>
          <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14, fontVariant: ["tabular-nums"] }}>{day.total.hm}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
        </View>
      </Pressable>
      {open ? (
        <Card pad={false}>
          {day.shifts.map((s, i) => <ShiftRow key={s.id} shift={s} count={n} last={i === n - 1} />)}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: sp[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  summaryCard: { flexGrow: 1, width: "30%", padding: sp[4] },
  label: { fontSize: 12.5, fontWeight: "600" },
  value: { fontSize: 26, fontWeight: "800", letterSpacing: -0.8, marginTop: 4, fontVariant: ["tabular-nums"] },
  cardPay: { marginTop: sp[2], fontSize: 14, fontWeight: "700" },
  payHero: { padding: sp[5], gap: 4 },
  payHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: sp[2], marginBottom: sp[2] },
  payBig: { fontSize: 38, fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  dayHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: sp[3], paddingHorizontal: sp[1] },
  // A panel, not a tint: surface2 against bg is a single value apart, and the
  // row read as loose text rather than as something to open.
  weekHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: sp[3], paddingHorizontal: sp[4], borderRadius: radius.md, borderWidth: 1 },
  // Stepped in, so a day's head inside is never taken for a week's.
  weekDays: { paddingLeft: sp[3], paddingTop: sp[1] },
});
