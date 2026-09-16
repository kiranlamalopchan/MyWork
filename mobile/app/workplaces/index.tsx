/**
 * My workplaces (templates/timeclock/workplace_list.html): your jobs, each
 * with its default star, edit and remove — and at the foot, where your own
 * week, fortnight and month begin.
 *
 * A job is a card rather than a row. Everything the server knows about one —
 * the rate, how it pays, whether it is cash, the hours cap — used to arrive
 * as a single `sub` line, which on a phone truncated after the address and
 * threw the rest away. Laid out as facts it all fits, and the three things
 * you can do to a job are named rather than left as three bare circles.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { timesheet, useTimesheetChanged, useWorkplaces, type Cycles, type Workplace } from "@/api";
import { Button, Card, Empty, ErrorBanner, Field, Input, Loading, Page, PageTitle, Screen, useLayout } from "@/ui";
import { notify } from "@/ui/confirm";
import { tap } from "@/ui/haptics";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { cssColour, hslAlpha } from "@/ui/timesheet";
import { Select } from "@/ui/Select";

export default function Workplaces() {
  const t = useTheme();
  const router = useRouter();
  const { wide } = useLayout();
  const q = useWorkplaces();
  const data = q.data;

  return (
    <Screen back backLabel="More">
      <Page>
        <PageTitle sub="The default one is picked automatically when you clock in. Each one keeps its own hours limit.">My workplaces</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {data && data.workplaces.length === 0 ? <Empty icon="home-outline" title="No workplaces yet" sub="Add the places you work so shifts can be recorded against them." /> : null}
        <View style={wide && styles.grid}>
          {(data?.workplaces ?? []).map((w) => (
            <View key={w.id} style={wide && styles.cell}>
              <Job w={w} />
            </View>
          ))}
        </View>
        {data ? <CyclesPanel cycles={data.cycles} choices={data.choices} /> : null}
        <Button title="Add workplace" icon="add" onPress={() => router.push("/workplaces/new")} testID="add-workplace" />
      </Page>
    </Screen>
  );
}

function Job({ w }: { w: Workplace }) {
  const t = useTheme();
  const router = useRouter();
  const changed = useTimesheetChanged();
  const hue = cssColour(w.css);

  return (
    <Card pad={false} style={styles.card} testID={`workplace-${w.id}`}>
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: hslAlpha(hue, 0.16) }]}>
          <Text style={{ color: hue, fontWeight: "800", fontSize: 17 }}>{w.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 16.5, flexShrink: 1 }} numberOfLines={1}>{w.name}</Text>
            {w.is_default ? (
              <View style={[styles.default, { backgroundColor: alpha(t.brand, 0.14) }]}>
                <Ionicons name="star" size={10} color={t.brandStrong} />
                <Text style={{ color: t.brandStrong, fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 }}>DEFAULT</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }} numberOfLines={1}>{w.address || "No address"}</Text>
        </View>
      </View>

      {/* The numbers, one to a chip: a phone truncates a sentence of them. */}
      <View style={styles.facts}>
        <Fact tint={w.hourly_rate ? t.brandStrong : undefined}>{w.hourly_rate ? `$${w.hourly_rate.toFixed(2)}/hr` : "No rate set"}</Fact>
        <Fact>{w.pay_cycle_label}</Fact>
        {w.in_cash ? <Fact tint={t.warn}>Cash</Fact> : w.tax_rate ? <Fact>{`${w.tax_rate}% tax`}</Fact> : null}
        {w.limit_label ? <Fact tint={t.violet}>{w.limit_label}</Fact> : null}
      </View>

      <View style={[styles.acts, { borderTopColor: t.line }]}>
        {!w.is_default ? (
          <Act icon="star-outline" label="Make default" a11y={`Make ${w.name} the default`} onPress={async () => { await timesheet.makeDefault(w.id); changed(); }} />
        ) : null}
        <Act icon="pencil-outline" label="Edit" a11y={`Edit ${w.name}`} onPress={() => router.push(`/workplaces/${w.id}/edit`)} />
        <Act icon="trash-outline" label="Remove" a11y={`Remove ${w.name}`} danger onPress={() => router.push(`/workplaces/${w.id}/remove`)} />
      </View>
    </Card>
  );
}

/** One fact about a job, in a tint that says which kind it is. */
function Fact({ children, tint }: { children: React.ReactNode; tint?: string }) {
  const t = useTheme();
  const ink = tint || t.text2;
  return <Text style={[styles.fact, { backgroundColor: alpha(ink, 0.11), color: ink }]}>{children}</Text>;
}

/**
 * Something you can do to a job, named.
 *
 * The name is for the eye and the accessibility label for a screen reader,
 * which needs to know *which* job — three rows of "Edit" would otherwise all
 * read the same.
 */
function Act({ icon, label, a11y, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; a11y: string; onPress: () => void; danger?: boolean;
}) {
  const t = useTheme();
  const ink = danger ? t.danger : t.text2;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => { tap("light"); onPress(); }}
      style={({ pressed }) => [styles.act, { backgroundColor: pressed ? alpha(ink, 0.12) : "transparent" }]}
    >
      <Ionicons name={icon} size={16} color={ink} />
      <Text style={{ color: ink, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </Pressable>
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
        <View style={[styles.panelIcon, { backgroundColor: alpha(t.blue, 0.13) }]}>
          <Ionicons name="calendar-outline" size={19} color={t.blue} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>My week &amp; cycles</Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }}>from {cycles.week_label}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={t.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.panelBody, { borderTopColor: t.line }]}>
          <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>These drive the totals that span every workplace, and the calendar grid. A workplace's own limit uses its own cycle, set on that workplace.</Text>
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[4] },
  cell: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  card: { padding: sp[4], gap: sp[3] },
  head: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  mark: { width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  default: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: sp[2] },
  fact: { paddingHorizontal: 9, paddingVertical: 3.5, borderRadius: radius.pill, fontSize: 12.5, fontWeight: "600", overflow: "hidden" },
  // Pulled out to the card's edges so the three read as one bar under it.
  acts: { flexDirection: "row", flexWrap: "wrap", gap: sp[1], marginHorizontal: -sp[2], marginBottom: -sp[1], paddingTop: sp[2], borderTopWidth: StyleSheet.hairlineWidth },
  act: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: sp[2], paddingVertical: sp[2], borderRadius: radius.sm, minHeight: 40 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[4], minHeight: 60 },
  panelIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  panelBody: { padding: sp[4], gap: sp[4], borderTopWidth: StyleSheet.hairlineWidth },
});
