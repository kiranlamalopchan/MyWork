/** A rostered shift, changed. */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { roster, useRoster, useRosterChanged } from "@/api";
import { useT } from "@/i18n";
import { goBack } from "@/nav/paths";
import { Empty, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { PlannedShiftForm } from "@/ui/PlannedShiftForm";
import { SkeletonForm } from "@/ui/Skeleton";
import { localStamp } from "@/ui/timesheet";

export default function EditPlannedShift() {
  const tr = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useRoster();
  const changed = useRosterChanged();
  const shift = q.data?.mine.find((s) => String(s.id) === id);
  return (
    <Screen back backLabel={tr("Roster")}>
      <Page>
        <PageTitle>{tr("Edit shift")}</PageTitle>
        {q.error && !q.data ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {!q.data && q.isLoading ? <SkeletonForm fields={4} /> : null}
        {q.data && !shift ? <Empty icon="calendar-outline" title={tr("That shift is no longer on your roster")} /> : null}
        {q.data && shift ? (
          <PlannedShiftForm
            workplaces={q.data.workplaces}
            editing
            initial={{ workplace: shift.workplace?.id ?? "", starts: localStamp(new Date(shift.starts)), ends: localStamp(new Date(shift.ends)), note: shift.note }}
            onSave={async (input) => { changed(await roster.edit(shift.id, input)); goBack(); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
