/** Add a shift by hand, for a day the clock was never started on. */
import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { timesheet, useTimesheetChanged } from "@/api";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonForm } from "@/ui/Skeleton";
import { ShiftForm } from "@/ui/ShiftForm";

export default function NewShift() {
  const router = useRouter();
  const { day } = useLocalSearchParams<{ day?: string }>();
  const q = useQuery({ queryKey: ["shift-new", day || ""], queryFn: () => timesheet.newShift(day) });
  const changed = useTimesheetChanged();
  return (
    <Screen back backLabel="Timesheet">
      <Page>
        <PageTitle sub="For a day you forgot to clock in on. Set the times you actually worked and add any breaks you took.">Add a shift</PageTitle>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonForm fields={4} /> : null}
        {q.data ? (
          <ShiftForm
            workplaces={q.data.workplaces}
            initial={{ workplace: q.data.workplace ?? "", clock_in: q.data.clock_in, clock_out: q.data.clock_out, note: "", breaks: [] }}
            editing={false}
            onSave={async (input) => { const shift = await timesheet.addShift(input); changed(); router.replace(`/shifts/${shift.id}`); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
