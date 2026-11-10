/** Dedicated profile destinations: a statement to keep and an activity overview. */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { timesheet, useActivity } from "@/api";
import { useT } from "@/i18n";
import { Button, Card, ErrorBanner, Field, Input, Page, PageTitle, Screen, usePullRefresh } from "./index";
import { SkeletonForm, SkeletonRows } from "./Skeleton";
import { openPdf } from "./pdf";
import { radius, sp, useTheme } from "./theme";
import { Choices } from "./timesheet";

function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() / 86400_000 : null;
}

export function StatementPage() {
  const t = useTheme(), tr = useT();
  const q = useActivity();
  const refresh = usePullRefresh(q.refetch);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workplace, setWorkplace] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const initialized = useRef(false);
  const st = q.data?.statement;
  useEffect(() => {
    if (st && !initialized.current) {
      initialized.current = true;
      setFrom(st.this_month[0]); setTo(st.this_month[1]);
    }
  }, [st]);

  const download = async () => {
    if (busy) return;
    const first = dayNumber(from), last = dayNumber(to);
    const next: Record<string, string> = {};
    if (first === null) next.from = tr("Enter a valid start date as YYYY-MM-DD.");
    if (last === null) next.to = tr("Enter a valid end date as YYYY-MM-DD.");
    if (first !== null && last !== null) {
      if (last < first) next.to = tr("Choose an end date on or after the start date.");
      else if (last - first >= 366) next.to = tr("Choose a date range of no more than one year.");
    }
    setErrors(next); setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try { await openPdf(timesheet.statementUrl(from, to, workplace), `statement-${from}-to-${to}.pdf`); }
    catch (error) { setFailure(error); }
    finally { setBusy(false); }
  };

  return <Screen back backLabel={tr("Profile")} section={tr("Statement")}>
    <Page refreshControl={refresh}>
      <PageTitle sub={tr("Your hours and pay, ready to download.")}>{tr("Statement")}</PageTitle>
      {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
      {q.isLoading && !st ? <SkeletonForm fields={3} /> : null}
      {st ? <Card style={{ gap: sp[4] }}>
        <Text style={{ color: t.text2, fontSize: 15, lineHeight: 22 }}>{tr("Choose a date range and a workplace, or include all your workplaces.")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
          <Button title={tr("This month")} kind="plain" size="sm" onPress={() => { setFrom(st.this_month[0]); setTo(st.this_month[1]); setErrors({}); }} />
          <Button title={tr("Last month")} kind="plain" size="sm" onPress={() => { setFrom(st.last_month[0]); setTo(st.last_month[1]); setErrors({}); }} />
        </View>
        <Field label={tr("From")} error={errors.from} help={tr("Use YYYY-MM-DD, for example 2026-11-01.")}>
          <Input value={from} onChangeText={(value) => { setFrom(value); setErrors({}); }} accessibilityLabel={tr("From")} invalid={!!errors.from} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} testID="statement-from" />
        </Field>
        <Field label={tr("To")} error={errors.to}>
          <Input value={to} onChangeText={(value) => { setTo(value); setErrors({}); }} accessibilityLabel={tr("To")} invalid={!!errors.to} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} testID="statement-to" />
        </Field>
        {st.workplaces.length > 1 ? <Field label={tr("Workplace")}>
          <Choices value={workplace} onChange={setWorkplace} options={[{ value: "" as number | "", label: tr("All workplaces") }, ...st.workplaces.map((w) => ({ value: w.id as number | "", label: w.name }))]} />
        </Field> : null}
        {Object.keys(errors).length ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{tr("Check the highlighted fields.")}</Text> : null}
        {failure ? <ErrorBanner error={failure} onRetry={download} /> : null}
        <Button title={tr("Download PDF")} icon="download-outline" onPress={download} busy={busy} testID="statement-download" />
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{tr("Save or share the PDF using your phone's share sheet.")}</Text>
      </Card> : null}
    </Page>
  </Screen>;
}

export function ActivityPage() {
  const t = useTheme(), tr = useT();
  const q = useActivity();
  const refresh = usePullRefresh(q.refetch);
  const a = q.data;
  const stats = a ? [[a.shift_count, "Shifts"], [a.workplace_count, "Workplaces"], [a.friend_count, "Friends"], [a.notice_count, "Notices"], [a.comment_count, "Comments"], [a.reactions_received, "Reactions received"]] as const : [];
  return <Screen back backLabel={tr("Profile")} section={tr("Activity")}>
    <Page refreshControl={refresh}>
      <PageTitle sub={tr("Your work and community at a glance.")}>{tr("Activity")}</PageTitle>
      {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
      {q.isLoading && !a ? <SkeletonRows count={3} /> : null}
      {a ? <>
        <Card style={[styles.lead, { backgroundColor: t.brandSoft }]}>
          <Text style={[styles.leadValue, { color: t.brand }]}>{a.week_hours.toFixed(1)}<Text style={{ fontSize: 22 }}> h</Text></Text>
          <Text style={{ color: t.text2, fontSize: 15, fontWeight: "600" }}>{tr("Worked this week")}</Text>
        </Card>
        <View style={styles.grid}>
          {stats.map(([count, label]) => <Card key={label} style={styles.stat}>
            <Text style={[styles.statValue, { color: t.text }]}>{count}</Text>
            <Text style={[styles.statLabel, { color: t.text2 }]}>{tr(label)}</Text>
          </Card>)}
        </View>
      </> : null}
    </Page>
  </Screen>;
}

const styles = StyleSheet.create({
  lead: { alignItems: "center", paddingVertical: sp[6], borderRadius: radius.xl, gap: sp[1] },
  leadValue: { fontSize: 44, fontWeight: "700", letterSpacing: -1.5, lineHeight: 54, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  stat: { flexBasis: "44%", flexGrow: 1, gap: sp[1] },
  statValue: { fontSize: 26, fontWeight: "700", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 14, lineHeight: 20 },
});
