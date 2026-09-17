import React from "react";
import { useRouter } from "expo-router";

import { timesheet, useTimesheetChanged, useWorkplaces } from "@/api";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonForm } from "@/ui/Skeleton";
import { WorkplaceForm } from "@/ui/WorkplaceForm";

export default function NewWorkplace() {
  const router = useRouter();
  const q = useWorkplaces();
  const changed = useTimesheetChanged();
  return (
    <Screen back backLabel="Workplaces">
      <Page>
        <PageTitle>Add workplace</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonForm fields={5} /> : null}
        {q.data ? (
          <WorkplaceForm
            choices={q.data.choices}
            cycles={q.data.cycles}
            onSave={async (input) => { await timesheet.addWorkplace(input); changed(); router.canGoBack() ? router.back() : router.replace("/workplaces"); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
