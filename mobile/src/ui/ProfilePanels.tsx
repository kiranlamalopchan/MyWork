/**
 * The profile page's other two panels (templates/accounts/profile.html): a
 * statement to keep — the dates you pick, one job or all, as a PDF — and
 * what you have done in MyWork.
 */
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, useActivity } from "@/api";

import { Button, Card, Field, Input } from "./index";
import { openPdf } from "./pdf";
import { notify } from "./confirm";
import { sp, useTheme } from "./theme";
import { Choices } from "./timesheet";

export function StatementPanel() {
  const t = useTheme();
  const q = useActivity();
  const [open, setOpen] = useState(false);
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
    <Card pad={false}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.head}>
        <Text style={[styles.title, { color: t.text }]}>Statement</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>PDF, any dates</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
      </Pressable>
      {open && st ? (
        <View style={[styles.body, { borderTopColor: t.line }]}>
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
        </View>
      ) : null}
    </Card>
  );
}

export function ActivityPanel() {
  const t = useTheme();
  const q = useActivity();
  const [open, setOpen] = useState(false);
  const a = q.data;
  const tally = (n: number, word: string) => (
    <View key={word} style={styles.tally}>
      <Text style={{ color: t.text, fontSize: 22, fontWeight: "700" }}>{n}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{word}{n === 1 ? "" : "s"}</Text>
    </View>
  );
  return (
    <Card pad={false}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.head}>
        <Text style={[styles.title, { color: t.text }]}>Activity</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>{a ? `${a.week_hours.toFixed(1)}h this week` : ""}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
      </Pressable>
      {open && a ? (
        <View style={[styles.body, { borderTopColor: t.line, alignItems: "center" }]}>
          <Text style={{ color: t.text, fontSize: 38, fontWeight: "700", letterSpacing: -1 }}>{a.week_hours.toFixed(1)}<Text style={{ fontSize: 20, color: t.muted }}>h</Text></Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: -sp[2] }}>worked this week</Text>
          <View style={styles.tallies}>
            {tally(a.shift_count, "shift")}
            {tally(a.workplace_count, "workplace")}
            {tally(a.notice_count, "notice")}
            {tally(a.comment_count, "comment")}
            {tally(a.reactions_received, "reaction")}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[4], minHeight: 60 },
  title: { fontSize: 16, fontWeight: "700", flex: 1 },
  body: { padding: sp[4], gap: sp[4], borderTopWidth: StyleSheet.hairlineWidth },
  tallies: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: sp[4], marginTop: sp[2] },
  tally: { alignItems: "center", minWidth: 80 },
});
