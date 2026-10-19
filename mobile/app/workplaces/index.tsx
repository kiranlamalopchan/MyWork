/**
 * My workplaces (templates/timeclock/workplace_list.html), kept to a list:
 * one row per job — its colour, its name, and one quiet line with what it
 * pays and when. Tapping a row opens it; making it the default, editing and
 * removing are in its ⋯ menu. Tax, cash and the hours cap are on the job
 * itself, one tap away, rather than spelled out under every name. Where your
 * own week, fortnight and month begin is one row at the foot.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, useTimesheetChanged, useWorkplaces, type Cycles, type Workplace } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, Input, Page, Screen } from "@/ui";
import { ActionMenu } from "@/ui/ActionMenu";
import { SkeletonWorkplaces } from "@/ui/Skeleton";
import { notify, tell } from "@/ui/confirm";
import { success, tap } from "@/ui/haptics";
import { sp, useTheme } from "@/ui/theme";
import { cssColour } from "@/ui/timesheet";
import { Select } from "@/ui/Select";

export default function Workplaces() {
  const t = useTheme();
  const router = useRouter();
  const q = useWorkplaces();
  const data = q.data;
  const jobs = data?.workplaces ?? [];

  return (
    <Screen back backLabel="More">
      <Page>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: t.text }]}>Workplaces</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Add workplace" testID="add-workplace" hitSlop={4}
            onPress={() => { tap("light"); router.push("/workplaces/new"); }}
            style={({ pressed }) => [styles.add, { backgroundColor: t.brand, opacity: pressed ? 0.8 : 1 }]}>
            <Ionicons name="add" size={24} color={t.brandInk} />
          </Pressable>
        </View>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonWorkplaces /> : null}
        {data && jobs.length === 0 ? <Empty icon="home-outline" title="No workplaces yet" sub="Add the places you work so shifts can be recorded against them." action={<Button title="Add workplace" icon="add" onPress={() => router.push("/workplaces/new")} />} /> : null}
        {jobs.length ? (
          <Card pad={false} style={{ overflow: "hidden" }}>
            {jobs.map((w, i) => <Job key={w.id} w={w} last={i === jobs.length - 1} />)}
          </Card>
        ) : null}
        {data ? <CyclesPanel cycles={data.cycles} choices={data.choices} /> : null}
      </Page>
    </Screen>
  );
}

function Job({ w, last }: { w: Workplace; last: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const changed = useTimesheetChanged();

  // Said out loud when it fails. The default simply not moving is what this
  // looked like before, which reads as the tap having missed.
  const makeDefault = async () => {
    try {
      await timesheet.makeDefault(w.id);
      changed();
      success();
    } catch (e: any) {
      notify("Couldn't make it the default", e?.message || "");
    }
  };
  const line = [w.hourly_rate ? `$${w.hourly_rate.toFixed(2)}/hr` : "No rate", w.pay_cycle_label].join(" · ");

  return (
    // The row and its ⋯ sit side by side rather than one inside the other: a
    // button inside a button is not something the web allows.
    <View testID={`workplace-${w.id}`} style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${w.name}${w.is_default ? ", default" : ""}, ${line}`} accessibilityHint="Opens this workplace"
        onPress={() => { tap("light"); router.push(`/workplaces/${w.id}/edit`); }}
        style={({ pressed }) => [styles.open, { opacity: pressed ? 0.6 : 1 }]}>
        <View style={[styles.dot, { backgroundColor: cssColour(w.css) }]} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.nameRow}>
            <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, flexShrink: 1 }} numberOfLines={1}>{w.name}</Text>
            {w.is_default ? <Text style={{ color: t.brandStrong, fontSize: 12, fontWeight: "700" }}>Default</Text> : null}
          </View>
          <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{line}</Text>
        </View>
      </Pressable>
      <ActionMenu label={`Actions for ${w.name}`} actions={[
        ...(w.is_default ? [] : [{ label: "Make default", accessibilityLabel: `Make ${w.name} the default`, icon: "star-outline" as const, onPress: makeDefault }]),
        { label: "Edit", accessibilityLabel: `Edit ${w.name}`, icon: "pencil-outline", onPress: () => router.push(`/workplaces/${w.id}/edit`) },
        { label: "Remove", accessibilityLabel: `Remove ${w.name}`, icon: "trash-outline", destructive: true, onPress: () => router.push(`/workplaces/${w.id}/remove`) },
      ]} />
    </View>
  );
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
      tell("Saved", "Where your week, fortnight and month begin.");
      setOpen(false);
    } catch (e: any) {
      notify("Not saved", e?.message || "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad={false}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.panelHead}>
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 15, flex: 1 }}>Week starts</Text>
        <Text style={{ color: t.muted, fontSize: 15 }} numberOfLines={1}>{cycles.week_label}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.panelBody, { borderTopColor: t.line }]}>
          <Field label="Week starts on" help="Also sets which day the calendar grid starts on.">
            <Select label="Week starts on" value={String(week)} onChange={(v) => setWeek(Number(v))} options={choices.weekdays.map((d) => ({ value: String(d.value), label: d.label }))} />
          </Field>
          <Field label="Fortnight starts on" help="Every fortnight opens on this day; the count starts again with it.">
            <Select label="Fortnight starts on" value={String(fortnight)} onChange={(v) => setFortnight(Number(v))} options={choices.weekdays.map((d) => ({ value: String(d.value), label: d.label }))} />
          </Field>
          <Field label="The fortnight you are in now began" help={cycles.fortnight_hint}>
            <Select label="The fortnight you are in now began" value={phase} onChange={setPhase} options={choices.phases.map((p) => ({ value: String(p.value), label: p.label }))} />
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
  head: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  title: { flex: 1, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: sp[1], paddingRight: sp[1] },
  open: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 64, paddingLeft: sp[4], paddingVertical: sp[2] },
  dot: { width: 10, height: 10, borderRadius: 5 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  panelHead: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingHorizontal: sp[4], minHeight: 56 },
  panelBody: { padding: sp[4], gap: sp[4], borderTopWidth: StyleSheet.hairlineWidth },
});
