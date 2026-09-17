/**
 * The profile page's other two panels (templates/accounts/profile.html): a
 * statement to keep — the dates you pick, one job or all, as a PDF — and
 * what you have done in MyWork. Each is an expandable item on the
 * profile's list; the page puts them on one surface.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { timesheet, useActivity } from "@/api";

import { Button, Field, Input } from "./index";
import { Disclosure } from "./Disclosure";
import { openPdf } from "./pdf";
import { notify } from "./confirm";
import { radius, sp, useTheme } from "./theme";
import { Choices } from "./timesheet";

/** Whether this item is the open one, and the tap that asks to be — the page decides. */
export type PanelProps = { open: boolean; onToggle: () => void; last?: boolean };

export function StatementPanel({ open, onToggle, last }: PanelProps) {
  const t = useTheme();
  const q = useActivity();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workplace, setWorkplace] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const st = q.data?.statement;
  useEffect(() => { if (st && !from) { setFrom(st.this_month[0]); setTo(st.this_month[1]); } }, [st]);

  const download = async () => {
    setBusy(true);
    try {
      await openPdf(timesheet.statementUrl(from, to, workplace), `statement-${from}-to-${to}.pdf`);
    } catch (e: any) {
      notify("No statement", e?.message || "Pick a start and an end date, the end after the start and no more than a year apart.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Disclosure icon="document-text-outline" tint={t.blue} title="Statement" hint="Hours and pay as a PDF, any dates" open={open} onToggle={onToggle} last={last}>
      {st ? (
        <>
          <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>Hours, pay and payments over the dates you pick, as a PDF to keep beside a payslip or a bank line.</Text>
          <View style={{ flexDirection: "row", gap: sp[2] }}>
            <Button title="This month" kind="plain" size="sm" onPress={() => { setFrom(st.this_month[0]); setTo(st.this_month[1]); }} />
            <Button title="Last month" kind="plain" size="sm" onPress={() => { setFrom(st.last_month[0]); setTo(st.last_month[1]); }} />
          </View>
          <View style={{ flexDirection: "row", gap: sp[3] }}>
            <View style={{ flex: 1 }}><Field label="From"><Input value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" /></Field></View>
            <View style={{ flex: 1 }}><Field label="To"><Input value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" /></Field></View>
          </View>
          {st.workplaces.length > 1 ? (
            <Field label="Workplace">
              <Choices value={workplace} onChange={setWorkplace} options={[{ value: "" as number | "", label: "All workplaces" }, ...st.workplaces.map((w) => ({ value: w.id as number | "", label: w.name }))]} />
            </Field>
          ) : null}
          <Button title="Download PDF" icon="download-outline" onPress={download} busy={busy} testID="statement-download" />
        </>
      ) : null}
    </Disclosure>
  );
}

export function ActivityPanel({ open, onToggle, last }: PanelProps) {
  const t = useTheme();
  const q = useActivity();
  const a = q.data;
  const stat = (n: number, word: string) => (
    <View key={word} style={[styles.stat, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
      <Text style={[styles.statValue, { color: t.text }]}>{n}</Text>
      <Text style={[styles.statLabel, { color: t.muted }]}>{word}{n === 1 ? "" : "s"}</Text>
    </View>
  );
  return (
    <Disclosure icon="pulse-outline" tint={t.violet} title="Activity" hint={a ? `${a.week_hours.toFixed(1)}h worked this week` : "What you've done in MeroKaam"} open={open} onToggle={onToggle} last={last}>
      {a ? (
        <>
          <View style={[styles.lead, { backgroundColor: t.brandSoft }]}>
            <Text style={[styles.leadValue, { color: t.brand }]}>{a.week_hours.toFixed(1)}<Text style={{ fontSize: 22 }}>h</Text></Text>
            <Text style={{ color: t.text2, fontSize: 13.5, fontWeight: "600" }}>worked this week</Text>
          </View>
          <View style={styles.grid}>
            {stat(a.shift_count, "shift")}
            {stat(a.workplace_count, "workplace")}
            {stat(a.friend_count, "friend")}
            {stat(a.notice_count, "notice")}
            {stat(a.comment_count, "comment")}
            {stat(a.reactions_received, "reaction")}
          </View>
        </>
      ) : null}
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  lead: { alignItems: "center", paddingVertical: sp[5], borderRadius: radius.md, gap: 2 },
  leadValue: { fontSize: 44, fontWeight: "700", letterSpacing: -1.5, lineHeight: 50, fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[2] },
  stat: { flexBasis: "30%", flexGrow: 1, alignItems: "center", paddingVertical: sp[3], paddingHorizontal: sp[2], borderRadius: radius.md },
  statValue: { fontSize: 22, fontWeight: "700", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  statLabel: { fontSize: 12.5, marginTop: 2 },
});
