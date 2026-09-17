/**
 * The shift form (templates/timeclock/shift_form.html): the workplace, the
 * two times, a note, and the breaks underneath — the same form for a day
 * the clock missed and for a wrong time being corrected. The server keeps
 * every rule (a future time, an overlap, a break outside the shift) and
 * says so in its own words.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ApiError, type ShiftInput, type WorkplaceBrief } from "@/api";

import { Button, Card, Field, Input } from "./index";
import { sp, useTheme } from "./theme";
import { Choices, DateTimeField, Switch } from "./timesheet";
import { fail, success } from "./haptics";

type BreakDraft = { key: string; id?: number; break_start: string; break_end: string; delete?: boolean };

export function ShiftForm({ workplaces, initial, editing, onSave, onCancel }: {
  workplaces: WorkplaceBrief[];
  initial: { workplace: number | ""; clock_in: string; clock_out: string; note: string; breaks: Omit<BreakDraft, "key">[] };
  editing: boolean;
  onSave: (input: ShiftInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [workplace, setWorkplace] = useState<number | "">(initial.workplace);
  const [clockIn, setClockIn] = useState(initial.clock_in);
  const [clockOut, setClockOut] = useState(initial.clock_out);
  const [note, setNote] = useState(initial.note);
  const [breaks, setBreaks] = useState<BreakDraft[]>(initial.breaks.map((b, i) => ({ ...b, key: `b${i}` })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [breakErrors, setBreakErrors] = useState<Record<string, string>[]>([]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const setBreak = (key: string, patch: Partial<BreakDraft>) => setBreaks((rows) => rows.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const save = async () => {
    setErrors({}); setBreakErrors([]); setDetail(""); setBusy(true);
    try {
      await onSave({
        workplace, clock_in: clockIn.replace(" ", "T"), clock_out: clockOut.replace(" ", "T"), note,
        breaks: breaks.filter((b) => b.id || b.break_start || b.break_end).map(({ key, ...b }) => ({ ...b, break_start: b.break_start.replace(" ", "T"), break_end: b.break_end.replace(" ", "T") })),
      });
      success();
    } catch (e: any) {
      fail();
      if (e instanceof ApiError) {
        const fields = e.fields as Record<string, any>;
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(fields)) if (k !== "breaks") flat[k] = Array.isArray(v) ? String(v[0]) : String(v);
        setErrors(flat);
        if (Array.isArray(fields.breaks) && typeof fields.breaks[0] === "object") {
          setBreakErrors(fields.breaks.map((row: Record<string, string[]>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v[0])]))));
        }
        setDetail(Object.keys(flat).length || Array.isArray(fields.breaks) ? (Array.isArray(fields.breaks) && typeof fields.breaks[0] === "string" ? String(fields.breaks[0]) : "") : e.message);
      } else {
        setDetail(e?.message || "That couldn't be saved.");
      }
    } finally {
      setBusy(false);
    }
  };

  // The server numbers rows existing-first; match that when showing errors.
  const ordered = [...breaks.filter((b) => b.id), ...breaks.filter((b) => !b.id)];

  return (
    <>
      {detail ? <Text style={{ color: t.danger, fontSize: 14 }}>{detail}</Text> : null}
      <Card style={{ gap: sp[4] }}>
        <Field label="Workplace" error={errors.workplace}>
          <Choices value={workplace} onChange={setWorkplace} options={workplaces.map((w) => ({ value: w.id as number | "", label: w.name }))} />
        </Field>
        <Field label="Clock in" error={errors.clock_in}>
          <DateTimeField value={clockIn} onChange={setClockIn} testID="clock-in-at" invalid={!!errors.clock_in} />
        </Field>
        <Field label="Clock out" error={errors.clock_out} help={editing ? "Leave clock-out empty to put the shift back to running." : "Leave clock-out empty if you're still working this one — it'll carry on as a running shift."}>
          <DateTimeField value={clockOut} onChange={setClockOut} placeholder="Still running" testID="clock-out-at" invalid={!!errors.clock_out} />
        </Field>
        <Field label="Note" error={errors.note}>
          <Input value={note} onChangeText={setNote} placeholder="Anything worth remembering" multiline style={{ minHeight: 72, textAlignVertical: "top" }} />
        </Field>
      </Card>
      <Card style={{ gap: sp[3] }}>
        <Text style={[styles.sectionLabel, { color: t.muted }]}>Breaks</Text>
        {breaks.map((b) => {
          const i = ordered.indexOf(b);
          const errs = breakErrors[i] || {};
          return (
            <View key={b.key} style={[styles.brk, { backgroundColor: t.dark ? t.surface2 : t.bg, opacity: b.delete ? 0.5 : 1 }]}>
              <View style={{ gap: sp[3] }}>
                <Field label="Start" error={errs.break_start}>
                  <DateTimeField value={b.break_start} onChange={(v) => setBreak(b.key, { break_start: v })} invalid={!!errs.break_start} />
                </Field>
                <Field label="End" error={errs.break_end}>
                  <DateTimeField value={b.break_end} onChange={(v) => setBreak(b.key, { break_end: v })} placeholder="Still on it" invalid={!!errs.break_end} />
                </Field>
              </View>
              {b.id ? (
                <Switch value={!!b.delete} onChange={(v) => setBreak(b.key, { delete: v })} label="Delete this break" danger />
              ) : (
                <Button title="Remove" kind="ghost" size="sm" icon="close" onPress={() => setBreaks((rows) => rows.filter((r) => r.key !== b.key))} style={{ alignSelf: "flex-end" }} />
              )}
            </View>
          );
        })}
        <Button title="Add a break" icon="add" kind="plain" onPress={() => setBreaks((rows) => [...rows, { key: `n${Date.now()}`, break_start: "", break_end: "" }])} />
      </Card>
      <View style={{ gap: sp[3] }}>
        <Button title={editing ? "Save changes" : "Add shift"} onPress={save} busy={busy} testID="save-shift" />
        <Button title="Cancel" kind="plain" onPress={onCancel} />
      </View>
    </>
  );
}

export function breakDrafts(breaks: { id: number; break_start: string; break_end: string | null }[]) {
  const local = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return breaks.map((b) => ({ id: b.id, break_start: local(b.break_start), break_end: local(b.break_end) }));
}

export const isoToLocal = (iso: string | null) => breakDrafts([{ id: 0, break_start: iso || "", break_end: null }])[0].break_start;

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.1 },
  brk: { gap: sp[3], padding: sp[3], borderRadius: 16 },
});
