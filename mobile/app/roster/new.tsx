/** A shift still to come, added to the roster. */
import React from "react";

import { roster, useRoster, useRosterChanged } from "@/api";
import { useT } from "@/i18n";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { PlannedShiftForm } from "@/ui/PlannedShiftForm";
import { SkeletonForm } from "@/ui/Skeleton";
import { localStamp } from "@/ui/timesheet";

export default function NewPlannedShift() {
  const tr = useT();
  const q = useRoster();
  const changed = useRosterChanged();
  // Tomorrow, nine to five: the commonest shift to be adding, and a day to change.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const at = (hour: number) => { const d = new Date(tomorrow); d.setHours(hour, 0, 0, 0); return localStamp(d); };
  const places = q.data?.workplaces;
  return (
    <Screen back backLabel={tr("Roster")}>
      <Page>
        <PageTitle sub={tr("The phone reminds you before it starts.")}>{tr("Add a shift")}</PageTitle>
        {q.error && !places ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {!places && q.isLoading ? <SkeletonForm fields={4} /> : null}
        {places ? (
          <PlannedShiftForm
            workplaces={places}
            editing={false}
            initial={{ workplace: (places.find((w) => w.is_default) || places[0])?.id ?? "", starts: at(9), ends: at(17), note: "" }}
            onSave={async (input) => { changed(await roster.add(input)); goBack(); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
