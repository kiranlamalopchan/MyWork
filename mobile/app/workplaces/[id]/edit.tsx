import React from "react";
import { useLocalSearchParams } from "expo-router";

import { timesheet, useTimesheetChanged, useWorkplaces } from "@/api";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Loading, Page, PageTitle, Screen } from "@/ui";
import { WorkplaceForm } from "@/ui/WorkplaceForm";

export default function EditWorkplace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useWorkplaces();
  const changed = useTimesheetChanged();
  const workplace = q.data?.workplaces.find((w) => w.id === Number(id));
  return (
    <Screen back backLabel="Workplaces">
      <Page>
        <PageTitle>Edit workplace</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data && workplace ? (
          <WorkplaceForm
            key={workplace.id}
            choices={q.data.choices}
            cycles={q.data.cycles}
            workplace={workplace}
            onSave={async (input) => { await timesheet.editWorkplace(workplace.id, input); changed(); goBack(); }}
            onCancel={goBack}
          />
        ) : null}
      </Page>
    </Screen>
  );
}
