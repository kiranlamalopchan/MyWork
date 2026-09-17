/**
 * Pay (templates/timeclock/payments.html): what each job still owes you,
 * and the button that clears it. One card per workplace and never one
 * total across them — two jobs pay on two different days.
 *
 * The strip at the top is hours, not money, for that reason: how long you
 * have gone unpaid is one question with one answer, where how much you are
 * owed is one question per job with a different payday behind each.
 *
 * A card leads with the figure and the button, and folds away what the
 * payment covered where there is a choice to make — it is already answered
 * for you and most payments are the whole of it, so it is a correction
 * rather than a step, and two jobs should not be two forms filling the
 * screen.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, usePay, useTimesheetChanged, type PayRow } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, Input, Page, PageTitle, Screen, useLayout } from "@/ui";
import { SkeletonPay } from "@/ui/Skeleton";
import { confirm, notify } from "@/ui/confirm";
import { alpha, mix, radius, sp, useTheme } from "@/ui/theme";
import { Choices, cssColour, hslAlpha } from "@/ui/timesheet";
import { success } from "@/ui/haptics";

export default function Pay() {
  const router = useRouter();
  const { wide } = useLayout();
  const q = usePay();
  const rows = q.data?.owing ?? [];
  const owing = rows.filter((r) => r.worked.seconds).length;

  return (
    <Screen back backLabel="More">
      <Page>
        <PageTitle>Pay</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonPay /> : null}
        {q.data && rows.length === 0 ? (
          <Empty icon="cash-outline" title="No workplaces yet" sub="Add one and the hours you work there start counting here." action={<Button title="Add a workplace" onPress={() => router.push("/workplaces/new")} />} />
        ) : null}
        {q.data && rows.length ? <Owing total={q.data.owed_total.hm} jobs={owing} /> : null}
        <View style={wide && styles.grid}>
          {rows.map((row) => (
            <View key={row.workplace.id} style={wide && styles.cell}>
              <Owed row={row} today={q.data!.today} />
            </View>
          ))}
        </View>
      </Page>
    </Screen>
  );
}

/** Hours unpaid, over everything — the one figure that is true across jobs. */
function Owing({ total, jobs }: { total: string; jobs: number }) {
  const t = useTheme();
  const clear = jobs === 0;
  return (
    <View style={[styles.owing, { backgroundColor: mix(clear ? t.brand : t.warn, t.surface, 0.1) }]}>
      <Text style={[styles.owingLabel, { color: clear ? t.brandStrong : t.warn }]}>
        {clear ? "All settled" : "Owed right now"}
      </Text>
      <Text style={[styles.owingBig, { color: t.text }]}>{clear ? "Nothing outstanding" : total}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {clear ? "Every job is paid up to date." : `Across ${jobs} job${jobs === 1 ? "" : "s"} — each one pays on its own day.`}
      </Text>
    </View>
  );
}

function Owed({ row, today }: { row: PayRow; today: string }) {
  const t = useTheme();
  const changed = useTimesheetChanged();
  const [covers, setCovers] = useState<string>(row.covers[0]?.value ? String(row.covers[0].value) : "date");
  const [upTo, setUpTo] = useState(today);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const w = row.workplace;
  const hue = cssColour(w.css);
  const owed = !!row.worked.seconds;
  // A job on a cycle with nothing due has no runs to pick between, so the
  // only thing left to say is the day — and a fold over a single field is a
  // tap that buys nothing.
  const choosing = row.covers.length > 0;
  const chosen = covers === "date"
    ? `Work up to ${upTo}`
    : row.covers.find((c) => String(c.value) === covers)?.label ?? "Everything so far";
  const day = (
    <Field label="Paid up to and including" help="Everything worked on or before this day is settled; the count starts again the day after.">
      <Input value={upTo} onChangeText={setUpTo} placeholder="YYYY-MM-DD" autoCapitalize="none" style={{ maxWidth: 180 }} />
    </Field>
  );

  const settle = () => confirm(`Mark ${w.name} paid?`, covers === "date" ? `Everything worked on or before ${upTo} is settled.` : undefined, "Payment received", async () => {
    setBusy(true);
    try {
      const page = await timesheet.recordPayment(w.id, covers, covers === "date" ? upTo : undefined);
      success();
      changed();
      setOpen(false);
      if (page.message) notify(page.message);
    } catch (e: any) {
      notify("Not recorded", e?.message || "");
    } finally {
      setBusy(false);
    }
  }, false);
  const undo = () => confirm(`Undo the last payment at ${w.name}?`, "Those hours go back to being owed.", "Undo", async () => {
    try { await timesheet.undoPayment(w.id); success(); changed(); } catch (e: any) { notify("Not undone", e?.message || ""); }
  });

  return (
    <Card testID={`pay-${w.id}`} pad={false} style={styles.card}>
      {/* The job, by its own colour: the same mark the workplaces page uses. */}
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: hslAlpha(hue, 0.16) }]}>
          <Text style={{ color: hue, fontWeight: "800", fontSize: 16 }}>{w.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16.5 }} numberOfLines={1}>{w.name}</Text>
          <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 1 }}>{row.cycle_label}</Text>
        </View>
        {!owed ? (
          <View style={[styles.settled, { backgroundColor: alpha(t.brand, 0.13) }]}>
            <Ionicons name="checkmark" size={13} color={t.brandStrong} />
            <Text style={{ color: t.brandStrong, fontSize: 11.5, fontWeight: "700" }}>Up to date</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.figures}>
        {owed ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: sp[3] }}>
              <Text style={[styles.big, { color: t.text }]}>{row.worked.hm}</Text>
              {row.owed_pay ? <Text style={{ color: t.brandStrong, fontSize: 21, fontWeight: "700", fontVariant: ["tabular-nums"] }}>${row.owed_pay.gross.toFixed(2)}</Text> : null}
            </View>
            <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>
              owed over {row.shifts} shift{row.shifts === 1 ? "" : "s"}{row.since ? ` since you were paid on ${row.since}` : ""}
            </Text>
          </>
        ) : (
          <Text style={{ color: t.muted, fontSize: 14.5 }}>
            {row.since ? `Paid up to ${row.since}.` : "No hours recorded here yet."}
          </Text>
        )}
      </View>

      {row.scheduled ? (
        <View style={[styles.runs, { borderTopColor: t.line }]}>
          {row.due.map((run) => (
            <View key={run.end!} style={styles.run}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 14 }}>{run.dates}</Text>
                <Text style={[styles.tag, { backgroundColor: t.warnSoft, color: t.warn }]}>due · payday {run.payday}</Text>
              </View>
              <Text style={{ color: t.text, fontWeight: "600", fontSize: 14 }}>{run.hours.toFixed(1)}h{run.pay ? ` · $${run.pay.gross.toFixed(2)}` : ""}</Text>
            </View>
          ))}
          {row.current ? (
            <View style={[styles.run, !row.current.payable && { opacity: 0.7 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 14 }}>This {row.period_label} · {row.current.dates}</Text>
                <Text style={[styles.tag, { backgroundColor: t.surface3, color: t.muted }]}>{row.current.payable ? `payday was ${row.current.payday}` : `paid ${row.current.payday}`}</Text>
              </View>
              <Text style={{ color: t.text, fontWeight: "600", fontSize: 14 }}>{row.current.hours.toFixed(1)}h{row.current.pay ? ` · $${row.current.pay.gross.toFixed(2)}` : ""}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {owed ? (
        <View style={styles.doing}>
          {choosing ? (
            <>
              {/* What the payment covered, as a line you read rather than a
                  form you fill: it is already answered, and tapping it is how
                  you disagree. */}
              <Pressable onPress={() => setOpen((v) => !v)} style={[styles.covers, { borderColor: t.line }]} testID={`covers-${w.id}`}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.coversLabel, { color: t.muted }]}>This payment covered</Text>
                  {/* Open, the chips below are the answer — saying it twice,
                      one above the other, reads as two different settings. */}
                  {open ? null : <Text style={{ color: t.text, fontSize: 14.5, fontWeight: "600", marginTop: 2 }} numberOfLines={1}>{chosen}</Text>}
                </View>
                <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
              </Pressable>
              {open ? (
                <View style={{ gap: sp[3] }}>
                  <Choices value={covers} onChange={setCovers} options={[...row.covers.map((c) => ({ value: String(c.value), label: c.label })), { value: "date", label: "Work up to a day I choose…" }]} />
                  {covers === "date" ? day : null}
                </View>
              ) : null}
            </>
          ) : day}
          <Button title="Payment received" icon="checkmark" onPress={settle} busy={busy} testID={`settle-${w.id}`} />
        </View>
      ) : null}

      {row.last_payment ? (
        <View style={[styles.last, { borderTopColor: t.line }]}>
          <Text style={{ color: t.muted, fontSize: 13, flex: 1 }}>
            Last paid {row.last_payment.covers_through} · {row.last_payment.hours}h{row.last_payment.amount != null ? ` · $${row.last_payment.amount.toFixed(2)}` : ""}
          </Text>
          <Text onPress={undo} style={{ color: t.text2, fontWeight: "700", fontSize: 13, padding: 4 }}>Undo</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Two jobs side by side once there is room for two readable columns.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[4] },
  cell: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  owing: { borderRadius: radius.lg, padding: sp[4], gap: 1 },
  owingLabel: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.55, textTransform: "uppercase" },
  owingBig: { fontSize: 30, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  card: { padding: sp[4], gap: sp[3] },
  head: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  mark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  settled: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  figures: { marginTop: sp[1] },
  big: { fontSize: 34, fontWeight: "800", letterSpacing: -1.2, fontVariant: ["tabular-nums"] },
  runs: { paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth, gap: sp[2] },
  run: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: 4 },
  tag: { alignSelf: "flex-start", marginTop: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, fontSize: 11, fontWeight: "600", overflow: "hidden" },
  doing: { gap: sp[3] },
  covers: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.md, borderWidth: 1 },
  coversLabel: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  last: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
});
