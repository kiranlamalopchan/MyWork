import React from "react";
import { useLocalSearchParams } from "expo-router";

import { timesheet, useTimesheetChanged, useWorkplaces } from "@/api";
import { goBack } from "@/nav/paths";
import { Button, Empty, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonForm } from "@/ui/Skeleton";
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
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonForm fields={5} /> : null}
        {/* The list arrived and this job was not in it — removed on another
            phone, or on the site. Without this the screen is a title and
            nothing else, with no way to tell it from one still loading. */}
        {q.data && !workplace ? (
          <Empty
            icon="business-outline"
            title="That workplace is gone"
            sub="It may have been removed here on another phone, or on the site."
            action={<Button title="Back to workplaces" onPress={goBack} />}
          />
        ) : null}
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
