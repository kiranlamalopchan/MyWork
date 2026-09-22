/** One shift (templates/timeclock/shift_detail.html): the hero figure, the ledger, the breaks, the note, and what you can do to it. */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { timesheet, useShift, useTimesheetChanged } from "@/api";
import { goBack } from "@/nav/paths";
import { Button, Card, ErrorBanner, Page, Screen } from "@/ui";
import { SkeletonShift } from "@/ui/Skeleton";
import { confirm } from "@/ui/confirm";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { Ledger, LedgerRow, Rule, StatusPill } from "@/ui/timesheet";

export default function ShiftScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useShift(Number(id));
  const changed = useTimesheetChanged();
  const s = q.data;

  const remove = () => confirm("Delete this shift?", "This can't be undone.", "Delete", async () => {
    await timesheet.removeShift(Number(id));
    changed();
    goBack();
  });

  return (
    <Screen back backLabel="Timesheet">
      <Page>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonShift /> : null}
        {s ? (
          <>
            <Card pad={false} style={styles.hero}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(s.status === "ON_BREAK" ? t.warn : t.brand, 0.08) }]} />
              <StatusPill status={s.status} label={s.status_label} />
              <Text style={[styles.worked, { color: t.text }]}>{s.worked.hm}</Text>
              <Text style={{ color: t.text2, fontSize: 14 }}>{s.workplace ? `${s.workplace.name} · ` : ""}{s.date_label}</Text>
            </Card>
            <Card>
              <Ledger>
                <LedgerRow label="Clock in" value={s.in_at} />
                <LedgerRow label="Clock out" value={s.out_at || "still running"} />
                <Rule />
                <LedgerRow label="Total shift" value={s.total.hm} />
                <LedgerRow label="Total break" value={`− ${s.total_break.hm}`} minus />
                <LedgerRow label="Worked" value={s.worked.hm} kind="total" />
                <LedgerRow label="Decimal hours" value={s.worked.decimal} kind="faint" />
                {s.pay ? <LedgerRow label={s.in_cash ? "Cash in hand" : "Gross pay"} value={`$${s.pay.gross.toFixed(2)}`} kind="faint" /> : null}
                {s.pay && s.withholds ? <LedgerRow label="Tax withheld" value={`−$${s.pay.tax.toFixed(2)}`} kind="faint" minus /> : null}
                {s.pay && s.withholds ? <LedgerRow label="Take-home" value={`$${s.pay.net.toFixed(2)}`} kind="faint" /> : null}
              </Ledger>
            </Card>
            <Card>
              <View style={styles.head}>
                <Text style={[styles.sectionLabel, { color: t.muted }]}>Breaks</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{s.breaks.length} total</Text>
              </View>
              {s.breaks.length ? s.breaks.map((b, i) => (
                <View key={b.id} style={[styles.brk, { backgroundColor: t.surface2 }]}>
                  <View style={[styles.no, { backgroundColor: b.is_running ? t.warnSoft : t.surface3 }]}><Text style={{ color: b.is_running ? t.warn : t.text2, fontSize: 12, fontWeight: "700" }}>{i + 1}</Text></View>
                  <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{b.start_at} <Text style={{ color: t.muted }}>→</Text> {b.end_at || "running"}</Text>
                  <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>{b.duration.minutes}</Text>
                </View>
              )) : <Text style={{ color: t.muted, fontSize: 14 }}>No breaks recorded for this shift.</Text>}
            </Card>
            {s.note ? (
              <Card>
                <Text style={[styles.sectionLabel, { color: t.muted }]}>Note</Text>
                <Text style={{ color: t.text, fontSize: 14, lineHeight: 20, marginTop: sp[2] }}>{s.note}</Text>
              </Card>
            ) : null}
            <View style={{ gap: sp[3] }}>
              <Button title="Edit times" icon="pencil-outline" onPress={() => router.push(`/shifts/${s.id}/edit`)} testID="edit-shift" />
              <Button title="Delete shift" icon="trash-outline" kind="danger" onPress={remove} testID="delete-shift" />
            </View>
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: sp[2], paddingVertical: sp[6], paddingHorizontal: sp[4], overflow: "hidden" },
  worked: { fontSize: 52, fontWeight: "700", letterSpacing: -1.5, lineHeight: 56, fontVariant: ["tabular-nums"] },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: sp[3] },
  sectionLabel: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.1 },
  brk: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.md, marginTop: sp[2] },
  no: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
