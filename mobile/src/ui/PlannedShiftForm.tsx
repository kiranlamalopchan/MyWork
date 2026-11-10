/**
 * A shift still to come: where, from when to when, and a word about it.
 * The same form adds one to the roster and changes one already on it. The
 * server keeps the rules — it must end after it starts, and not already be
 * over — and each refusal is shown under the box it is about.
 */
import React, { useState } from "react";
import { Text, View } from "react-native";

import { fieldErrors } from "@/api/client";
import type { PlannedInput, WorkplaceBrief } from "@/api";
import { useT } from "@/i18n";
import { errorMessage } from "@/api/errors";

import { Button, Card, Field, Input } from "./index";
import { fail, success } from "./haptics";
import { sp, useTheme } from "./theme";
import { Choices, DateTimeField, parseStamp } from "./timesheet";

const BOXES = { workplace: "workplace", starts: "starts", ends: "ends", note: "note" };

export function PlannedShiftForm({ workplaces, initial, editing, onSave, onCancel }: {
  workplaces: WorkplaceBrief[];
  initial: PlannedInput;
  editing: boolean;
  onSave: (input: PlannedInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTheme(), tr = useT();
  const [workplace, setWorkplace] = useState<number | "">(initial.workplace);
  const [starts, setStarts] = useState(initial.starts);
  const [ends, setEnds] = useState(initial.ends);
  const [note, setNote] = useState(initial.note);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErrors({});
    // The phone's wall-clock time, sent as the instant it means here.
    const from = parseStamp(starts), to = parseStamp(ends);
    if (!from || !to) {
      fail();
      setErrors({ [from ? "ends" : "starts"]: tr("Choose a date and a time.") });
      return;
    }
    setBusy(true);
    try {
      await onSave({ workplace, starts: from.toISOString(), ends: to.toISOString(), note: note.trim() });
      success();
    } catch (error) {
      fail();
      const fields = fieldErrors(error, BOXES, "form");
      if (fields.form) fields.form = errorMessage(error);
      setErrors(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, tr(value)])));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: sp[4] }}>
      <Field label={tr("Workplace")} error={errors.workplace}>
        <Choices value={workplace} onChange={setWorkplace} options={workplaces.map((w) => ({ value: w.id, label: w.name, css: w.css }))} />
      </Field>
      <Field label={tr("Starts")} error={errors.starts}>
        <DateTimeField value={starts} onChange={setStarts} invalid={!!errors.starts} testID="planned-starts" />
      </Field>
      <Field label={tr("Ends")} error={errors.ends}>
        <DateTimeField value={ends} onChange={setEnds} invalid={!!errors.ends} testID="planned-ends" />
      </Field>
      <Field label={tr("Note")} help={tr("Optional — “Opening”, “Covering for Sam”.")} error={errors.note}>
        <Input value={note} onChangeText={setNote} maxLength={200} placeholder={tr("Anything worth remembering")} testID="planned-note" />
      </Field>
      {errors.form ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14 }}>{errors.form}</Text> : null}
      <View style={{ flexDirection: "row", gap: sp[3] }}>
        <Button title={tr("Cancel")} kind="plain" onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
        <Button title={editing ? tr("Save changes") : tr("Add to roster")} onPress={save} busy={busy} style={{ flex: 1 }} testID="planned-save" />
      </View>
    </Card>
  );
}
