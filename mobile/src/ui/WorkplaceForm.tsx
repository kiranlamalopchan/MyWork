/**
 * Everything about one workplace (templates/timeclock/workplace_form.html),
 * its own hours cap included: the name and colour, how it pays and how you
 * are paid, the rate and the tax, the limit and the cycles it is counted
 * over. A payslip can fill the boxes; you still see every value before it
 * is sent.
 */
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, timesheet, type Workplace, type WorkplaceInput, type WorkplacesPage } from "@/api";
import type { FilePart } from "@/api/client";

import { Button, Card, Field, Input, SectionLabel } from "./index";
import { native } from "./native";
import { notify } from "./confirm";
import { alpha, mix, radius, sp, useTheme } from "./theme";
import { cssColour, Switch } from "./timesheet";
import { Select } from "./Select";
import { fail, success } from "./haptics";

type Choices = WorkplacesPage["choices"];

export function WorkplaceForm({ choices, workplace, cycles, onSave, onCancel }: {
  choices: Choices; workplace?: Workplace; cycles: WorkplacesPage["cycles"];
  onSave: (input: WorkplaceInput) => Promise<void>; onCancel: () => void;
}) {
  const t = useTheme();
  const w = workplace;
  const [name, setName] = useState(w?.name || "");
  const [address, setAddress] = useState(w?.address || "");
  const [color, setColor] = useState<number | "">(w?.hue ?? "");
  const [payCycle, setPayCycle] = useState(w?.pay_cycle || "IRREGULAR");
  const [paidIn, setPaidIn] = useState(w?.paid_in || "BANK");
  const [rate, setRate] = useState(w?.hourly_rate != null ? String(w.hourly_rate) : "");
  const [tax, setTax] = useState(w?.tax_rate != null ? String(w.tax_rate) : "");
  const [limit, setLimit] = useState(w?.hours_limit != null ? String(w.hours_limit) : "");
  const [limitPeriod, setLimitPeriod] = useState(w?.limit_period || "FORTNIGHT");
  const [week, setWeek] = useState(w?.week_starts_on ?? cycles.week_starts_on);
  const [fortnight, setFortnight] = useState(w?.fortnight_starts_on ?? cycles.fortnight_starts_on);
  const [phase, setPhase] = useState<string>(w?.fortnight_phase || cycles.fortnight_phase);
  const [month, setMonth] = useState(String(w?.month_starts_on ?? cycles.month_starts_on));
  const [isDefault, setIsDefault] = useState(w?.is_default || false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<{ label: string; value: string; how: string }[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [reading, setReading] = useState(false);

  const fillFromPayslip = async () => {
    setReading(true);
    try {
      // Loaded on tap so a build without the picker still shows the form.
      const DocumentPicker = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
      const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/*"], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file: FilePart = Platform.OS === "web"
        ? ((asset as any).file || (new File([await (await fetch(asset.uri)).blob()], asset.name, { type: asset.mimeType || "" }))) as unknown as FilePart
        : { uri: asset.uri, name: asset.name, type: asset.mimeType || "application/octet-stream" };
      const slip = await timesheet.readPayslip(file);
      const f = slip.fields;
      if (f.name && !name) setName(String(f.name));
      if (f.hourly_rate != null) setRate(String(f.hourly_rate));
      if (f.tax_rate != null) setTax(String(f.tax_rate));
      if (f.pay_cycle) setPayCycle(String(f.pay_cycle) as Workplace["pay_cycle"]);
      if (f.limit_period) setLimitPeriod(String(f.limit_period) as Workplace["limit_period"]);
      if (f.week_starts_on != null) setWeek(Number(f.week_starts_on));
      if (f.fortnight_starts_on != null) setFortnight(Number(f.fortnight_starts_on));
      if (f.fortnight_phase) setPhase(String(f.fortnight_phase));
      if (f.month_starts_on != null) setMonth(String(f.month_starts_on));
      setRead(slip.read);
      setNotes(slip.notes);
    } catch (e: any) {
      notify("Couldn't read that payslip", e?.message || "");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setErrors({}); setDetail(""); setBusy(true);
    try {
      await onSave({
        name, address, color, pay_cycle: payCycle, paid_in: paidIn, hourly_rate: rate, tax_rate: paidIn === "CASH" ? "" : tax,
        hours_limit: limit, limit_period: limitPeriod, week_starts_on: week, fortnight_starts_on: fortnight, fortnight_phase: phase,
        month_starts_on: month, is_default: isDefault,
      });
      success();
    } catch (e: any) {
      fail();
      if (e instanceof ApiError) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(e.fields)) flat[k] = Array.isArray(v) ? String(v[0]) : String(v);
        setErrors(flat);
        if (!Object.keys(flat).length) setDetail(e.message);
      } else setDetail(e?.message || "That couldn't be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {detail ? <Text style={{ color: t.danger, fontSize: 14 }}>{detail}</Text> : null}

      {/* The payslip reader fills half of what is below it, so it leads rather
          than sitting inside the first group as a small grey button. */}
      <View style={[styles.payslip, { backgroundColor: mix(t.violet, t.surface, 0.1) }]}>
        <View style={styles.payslipHead}>
          <View style={[styles.payslipIcon, { backgroundColor: alpha(t.violet, 0.16) }]}>
            <Ionicons name="document-text-outline" size={21} color={t.violet} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Fill from a payslip</Text>
            <Text style={{ color: t.muted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>PDF, photo or screenshot — the rate, tax and pay cycle are read off it for you to check.</Text>
          </View>
        </View>
        <Button title={reading ? "Reading…" : "Choose a file"} icon="cloud-upload-outline" kind="plain" size="sm" onPress={fillFromPayslip} busy={reading} style={{ alignSelf: "flex-start" }} />
        {read ? (
          <View style={[styles.read, { backgroundColor: t.surface }]}>
            {read.map((r) => <Text key={r.label} style={{ color: t.text2, fontSize: 13 }}><Text style={{ fontWeight: "700", color: t.text }}>{r.label}:</Text> {r.value} <Text style={{ color: t.muted }}>— {r.how}</Text></Text>)}
            {notes.map((n) => <Text key={n} style={{ color: t.warn, fontSize: 13 }}>{n}</Text>)}
          </View>
        ) : null}
      </View>

      {/* Four groups rather than one column of fourteen boxes: what the job
          is, how it pays, the cap on it, and the cycles that cap is counted
          over. They are four different questions and only the first is
          always worth answering. */}
      <SectionLabel>The job</SectionLabel>
      <Card style={{ gap: sp[4] }}>
        <Field label="Workplace name" error={errors.name}>
          <Input value={name} onChangeText={setName} placeholder="e.g. Courtlands Aged Care" testID="wp-name" />
        </Field>
        <Field label="Address (optional)" error={errors.address}>
          <Input value={address} onChangeText={setAddress} placeholder="Street, suburb" />
        </Field>
        <Field label="Colour" help="How this job is marked on the calendar and beside its shifts." error={errors.color}>
          {/* Eight across one row, and a tick rather than only a ring: a ring
              alone is a difference in colour, which is the one thing this
              control cannot rely on. */}
          <View style={{ flexDirection: "row", gap: 3 }}>
            {choices.colors.map((c) => {
              const on = c.value === color;
              return (
                <Pressable key={c.value} onPress={() => setColor(c.value)} accessibilityRole="button" accessibilityLabel={c.label} accessibilityState={{ selected: on }} style={[styles.swatchRing, { borderColor: on ? cssColour(c.css) : "transparent" }]}>
                  <View style={[styles.swatch, { backgroundColor: cssColour(c.css) }]}>
                    {on ? <Ionicons name="checkmark" size={17} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Field>
        <Switch value={isDefault} onChange={setIsDefault} label="Use as my default workplace" />
      </Card>

      <SectionLabel>How it pays</SectionLabel>
      <Card style={{ gap: sp[4] }}>
        <Field label="How this job pays" help="On a cycle, the pay run uses the same week / fortnight / month settings below — payday is the last day of each run." error={errors.pay_cycle}>
          <Select label="How this job pays" value={payCycle} onChange={(v) => setPayCycle(v as Workplace["pay_cycle"])} options={choices.pay_cycles.map((c) => ({ value: String(c.value), label: c.label }))} />
        </Field>
        <Field label="How you're paid" help="Cash in hand has no tax to take off, so the withholding below drops away and every figure is simply what you earned." error={errors.paid_in}>
          <Select label="How you're paid" value={paidIn} onChange={(v) => setPaidIn(v as Workplace["paid_in"])} options={choices.paid_in.map((c) => ({ value: String(c.value), label: c.label }))} />
        </Field>
        <Field label="Hourly rate (optional)" help="Optional. Used to estimate pay alongside your hours." error={errors.hourly_rate}>
          <Input value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="e.g. 28.50" style={{ maxWidth: 160 }} />
        </Field>
        {paidIn !== "CASH" ? (
          <Field label="Tax withheld % (optional)" help="From a payslip: tax withheld ÷ gross × 100. Leave blank to show pay before tax." error={errors.tax_rate}>
            <Input value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="e.g. 10.8" style={{ maxWidth: 160 }} />
          </Field>
        ) : null}
      </Card>

      <SectionLabel>Hours cap</SectionLabel>
      <Card style={{ gap: sp[4] }}>
        <Field label="Hours limit here (optional)" help="Counted against this workplace only. Leave blank for no limit." error={errors.hours_limit}>
          <Input value={limit} onChangeText={setLimit} keyboardType="decimal-pad" placeholder="e.g. 48" style={{ maxWidth: 160 }} />
        </Field>
        {/* Nothing to apply until there is a number to apply it to. */}
        {limit.trim() ? (
          <Field label="Applies" error={errors.limit_period}>
            <Select label="Applies" value={limitPeriod} onChange={(v) => setLimitPeriod(v as Workplace["limit_period"])} options={choices.limit_periods.map((c) => ({ value: String(c.value), label: c.label }))} />
          </Field>
        ) : null}
      </Card>

      <SectionLabel>This job's cycles</SectionLabel>
      <Card style={{ gap: sp[4] }}>
        <Field label="Week starts on" help="Used for a weekly limit, and for this job's week totals." error={errors.week_starts_on}>
          <Select label="Week starts on" value={String(week)} onChange={(v) => setWeek(Number(v))} options={choices.weekdays.map((d) => ({ value: String(d.value), label: d.label }))} />
        </Field>
        <Field label="Fortnight starts on" help="Every fortnight opens on this day; the count starts again with it." error={errors.fortnight_starts_on}>
          <Select label="Fortnight starts on" value={String(fortnight)} onChange={(v) => setFortnight(Number(v))} options={choices.weekdays.map((d) => ({ value: String(d.value), label: d.label }))} />
        </Field>
        <Field label="The fortnight you are in now began" help={w?.fortnight_hint || cycles.fortnight_hint} error={errors.fortnight_phase}>
          <Select label="The fortnight you are in now began" value={phase} onChange={setPhase} options={choices.phases.map((p) => ({ value: String(p.value), label: p.label }))} />
        </Field>
        <Field label="Month starts on day" help={`1–${choices.max_month_start}. Use the day your pay month opens.`} error={errors.month_starts_on}>
          <Input value={month} onChangeText={setMonth} keyboardType="number-pad" style={{ maxWidth: 120 }} />
        </Field>
      </Card>
      <View style={{ gap: sp[3] }}>
        <Button title={w ? "Save changes" : "Add workplace"} onPress={save} busy={busy} testID="save-workplace" />
        <Button title="Cancel" kind="plain" onPress={onCancel} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  payslip: { borderRadius: radius.lg, padding: sp[4], gap: sp[3] },
  payslipHead: { flexDirection: "row", gap: sp[3] },
  payslipIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  read: { padding: sp[3], borderRadius: radius.md, gap: 4 },
  swatchRing: { padding: 2.5, borderRadius: 21, borderWidth: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
