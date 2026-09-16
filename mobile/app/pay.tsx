/**
 * Pay (templates/timeclock/payments.html): what each job still owes you,
 * and the button that clears it. One card per workplace and never one
 * total across them — two jobs pay on two different days.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { timesheet, usePay, useTimesheetChanged, type PayRow } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Page, PageTitle, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { Choices, cssColour, Swatch } from "@/ui/timesheet";
import { success } from "@/ui/haptics";

export default function Pay() {
  const t = useTheme();
  const router = useRouter();
  const q = usePay();
  const rows = q.data?.owing ?? [];
  return (
    <Screen back backLabel="More">
      <Page>
        <PageTitle>Pay</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data && rows.length === 0 ? (
          <Empty icon="cash-outline" title="No workplaces yet" sub="Add one and the hours you work there start counting here." action={<Button title="Add a workplace" onPress={() => router.push("/workplaces/new")} />} />
        ) : null}
        {rows.map((row) => <Owed key={row.workplace.id} row={row} today={q.data!.today} />)}
      </Page>
    </Screen>
  );
}

function Owed({ row, today }: { row: PayRow; today: string }) {
  const t = useTheme();
  const changed = useTimesheetChanged();
  const [covers, setCovers] = useState<string>(row.covers[0]?.value ? String(row.covers[0].value) : "date");
  const [upTo, setUpTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const w = row.workplace;

  const settle = () => confirm(`Mark ${w.name} paid?`, covers === "date" ? `Everything worked on or before ${upTo} is settled.` : undefined, "Payment received", async () => {
    setBusy(true);
    try {
      const page = await timesheet.recordPayment(w.id, covers, covers === "date" ? upTo : undefined);
      success();
      changed();
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
    <Card testID={`pay-${w.id}`}>
      <View style={styles.head}>
        <Swatch css={cssColour(w.css)} size={12} />
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16, flex: 1 }}>{w.name}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>{row.cycle_label}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: sp[3], marginTop: sp[2] }}>
        <Text style={{ color: t.text, fontSize: 36, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] }}>{row.worked.hm}</Text>
        {row.owed_pay ? <Text style={{ color: t.text2, fontSize: 20, fontWeight: "600" }}>${row.owed_pay.gross.toFixed(2)}</Text> : null}
      </View>
      <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 2 }}>
        {row.worked.seconds
          ? `owed over ${row.shifts} shift${row.shifts === 1 ? "" : "s"}${row.since ? ` since you were paid on ${row.since}` : ""}`
          : `nothing outstanding${row.since ? ` — paid up to ${row.since}` : ""}`}
      </Text>
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
      {row.worked.seconds ? (
        <View style={{ gap: sp[3], marginTop: sp[4] }}>
          <Field label="This payment covered">
            <Choices value={covers} onChange={setCovers} options={[...row.covers.map((c) => ({ value: String(c.value), label: c.label })), { value: "date", label: "Work up to a day I choose…" }]} />
          </Field>
          {covers === "date" ? (
            <Field label="Paid up to and including" help="Everything worked on or before this day is settled; the count starts again the day after.">
              <Input value={upTo} onChangeText={setUpTo} placeholder="YYYY-MM-DD" autoCapitalize="none" style={{ maxWidth: 180 }} />
            </Field>
          ) : null}
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
  head: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  runs: { marginTop: sp[3], paddingTop: sp[2], borderTopWidth: StyleSheet.hairlineWidth, gap: sp[2] },
  run: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: 4 },
  tag: { alignSelf: "flex-start", marginTop: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, fontSize: 11, fontWeight: "600", overflow: "hidden" },
  last: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[4], paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
});
