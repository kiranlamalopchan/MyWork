/**
 * My workplaces (templates/timeclock/workplace_list.html): your jobs, each
 * with its default star, edit and remove — and at the foot, where your own
 * week, fortnight and month begin.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, useTimesheetChanged, useWorkplaces, type Cycles } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, IconButton, Input, Loading, Page, PageTitle, Screen } from "@/ui";
import { notify } from "@/ui/confirm";
import { radius, sp, useTheme } from "@/ui/theme";
import { Choices, cssColour } from "@/ui/timesheet";

export default function Workplaces() {
  const t = useTheme();
  const router = useRouter();
  const q = useWorkplaces();
  const changed = useTimesheetChanged();
  const data = q.data;

  return (
    <Screen back backLabel="More">
      <Page>
        <PageTitle sub="The default one is picked automatically when you clock in. Each one keeps its own hours limit.">My workplaces</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {data && data.workplaces.length === 0 ? <Empty icon="home-outline" title="No workplaces yet" sub="Add the places you work so shifts can be recorded against them." /> : null}
        {data && data.workplaces.length ? (
          <Card pad={false}>
            {data.workplaces.map((w, i) => (
              <View key={w.id} style={[styles.row, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]} testID={`workplace-${w.id}`}>
                <View style={[styles.mark, { backgroundColor: hsla(cssColour(w.css), 0.16) }]}>
                  <Text style={{ color: cssColour(w.css), fontWeight: "700", fontSize: 16 }}>{w.name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }} numberOfLines={1}>{w.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>
                    {w.is_default ? <Text style={{ color: t.brand, fontWeight: "700", fontSize: 11, letterSpacing: 0.5 }}>DEFAULT  </Text> : null}{w.sub}
                  </Text>
                </View>
                {!w.is_default ? <IconButton icon="star-outline" label={`Make ${w.name} the default`} onPress={async () => { await timesheet.makeDefault(w.id); changed(); }} style={[styles.act, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]} /> : null}
                <IconButton icon="pencil-outline" label={`Edit ${w.name}`} onPress={() => router.push(`/workplaces/${w.id}/edit`)} style={[styles.act, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]} />
                <IconButton icon="trash-outline" label={`Remove ${w.name}`} color={t.danger} onPress={() => router.push(`/workplaces/${w.id}/remove`)} style={[styles.act, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]} />
              </View>
            ))}
          </Card>
        ) : null}
        {data ? <CyclesPanel cycles={data.cycles} choices={data.choices} /> : null}
        <Button title="Add workplace" icon="add" onPress={() => router.push("/workplaces/new")} testID="add-workplace" />
      </Page>
    </Screen>
  );
}

function hsla(css: string, a: number) {
  return css.replace(/^hsl\((.*)\)$/, `hsla($1, ${a})`);
}

/** Where your own week, fortnight and month begin — a panel at the foot. */
function CyclesPanel({ cycles, choices }: { cycles: Cycles; choices: { weekdays: { value: number; label: string }[]; phases: { value: string | number; label: string }[]; max_month_start: number } }) {
  const t = useTheme();
  const changed = useTimesheetChanged();
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState(cycles.week_starts_on);
  const [fortnight, setFortnight] = useState(cycles.fortnight_starts_on);
  const [phase, setPhase] = useState<string>(cycles.fortnight_phase);
  const [month, setMonth] = useState(String(cycles.month_starts_on));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setWeek(cycles.week_starts_on); setFortnight(cycles.fortnight_starts_on); setPhase(cycles.fortnight_phase); setMonth(String(cycles.month_starts_on)); }, [cycles]);

  const save = async () => {
    setBusy(true);
    try {
      await timesheet.savePreferences({ week_starts_on: week, fortnight_starts_on: fortnight, fortnight_phase: phase as "this" | "last", month_starts_on: Number(month) });
      changed();
      notify("Saved", "Where your week, fortnight and month begin.");
      setOpen(false);
    } catch (e: any) {
      notify("Not saved", e?.message || "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad={false}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.panelHead}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 16, flex: 1 }}>My week & cycles</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>from {cycles.week_label}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.panelBody, { borderTopColor: t.line }]}>
          <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>These drive the totals that span every workplace, and the calendar grid. A workplace's own limit uses its own cycle, set on that workplace.</Text>
          <Field label="Week starts on" help="Also sets which day the calendar grid starts on.">
            <Choices value={week} onChange={setWeek} options={choices.weekdays.map((d) => ({ value: d.value, label: d.label.slice(0, 3) }))} />
          </Field>
          <Field label="Fortnight starts on" help="Every fortnight opens on this day; the count starts again with it.">
            <Choices value={fortnight} onChange={setFortnight} options={choices.weekdays.map((d) => ({ value: d.value, label: d.label.slice(0, 3) }))} />
          </Field>
          <Field label="The fortnight you are in now began" help={cycles.fortnight_hint}>
            <Choices value={phase} onChange={setPhase} options={choices.phases.map((p) => ({ value: String(p.value), label: p.label }))} />
          </Field>
          <Field label="Month starts on day" help={`1–${choices.max_month_start}. Use 1 for the calendar month.`}>
            <Input value={month} onChangeText={setMonth} keyboardType="number-pad" style={{ maxWidth: 120 }} />
          </Field>
          <Button title="Save cycles" onPress={save} busy={busy} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[2], padding: sp[3], paddingLeft: sp[4] },
  mark: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginRight: sp[1] },
  act: { width: 38, height: 38, borderRadius: 19 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[4], minHeight: 60 },
  panelBody: { padding: sp[4], gap: sp[4], borderTopWidth: StyleSheet.hairlineWidth },
});
