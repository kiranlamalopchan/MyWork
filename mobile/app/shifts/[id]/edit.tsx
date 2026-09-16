/** Correct a shift's times, and add, fix or remove its breaks. */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { timesheet, useShift, useTimesheetChanged, useWorkplaces } from "@/api";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Loading, Page, PageTitle, Screen } from "@/ui";
import { breakDrafts, isoToLocal, ShiftForm } from "@/ui/ShiftForm";

export default function EditShift() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useShift(Number(id));
  const places = useWorkplaces();
  const changed = useTimesheetChanged();
  const s = q.data;
  return (
    <Screen back backLabel="Back to shift">
      <Page>
        <PageTitle sub="Totals are worked out from these times, so fixing one here fixes every figure built on it.">Edit shift</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading || places.isLoading ? <Loading /> : null}
        {s && places.data ? (
          <ShiftForm
            workplaces={places.data.workplaces}
            initial={{ workplace: s.workplace?.id ?? "", clock_in: isoToLocal(s.clock_in), clock_out: isoToLocal(s.clock_out), note: s.note, breaks: breakDrafts(s.breaks) }}
            editing
            onSave={async (input) => { await timesheet.editShift(s.id, input); changed(); goBack(); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
