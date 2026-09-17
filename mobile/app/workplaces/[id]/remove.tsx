/** What removing this workplace would take with it (workplace_confirm_delete.html) — a screen, because the answer is a list of counts. */
import React, { useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { timesheet, useTimesheetChanged } from "@/api";
import { goBack } from "@/nav/paths";
import { Button, Card, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonRemove } from "@/ui/Skeleton";
import { notify } from "@/ui/confirm";
import { sp, useTheme } from "@/ui/theme";
import { cssColour, Ledger, LedgerRow, Swatch } from "@/ui/timesheet";

export default function RemoveWorkplace() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["removal", id], queryFn: () => timesheet.removal(Number(id)) });
  const changed = useTimesheetChanged();
  const [busy, setBusy] = useState(false);
  const d = q.data;

  const remove = async () => {
    setBusy(true);
    try {
      await timesheet.removeWorkplace(Number(id));
      changed();
      router.canGoBack() ? router.back() : router.replace("/workplaces");
    } catch (e: any) {
      notify("Not removed", e?.message || "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back backLabel="Workplaces">
      <Page>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRemove /> : null}
        {d ? (
          <>
            <PageTitle>Remove {d.workplace.name}?</PageTitle>
            <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: -sp[2] }}>
              <Swatch css={cssColour(d.workplace.css)} size={12} />
              <Text style={{ color: t.muted, fontSize: 14.5 }}>This cannot be undone</Text>
            </View>
            {d.clocked_in ? <ErrorBanner message="You're clocked in at that workplace. Clock out first." /> : null}
            <Card>
              {d.going.shifts || d.going.payments ? (
                <>
                  <Text style={{ color: t.muted, fontSize: 13.5, fontWeight: "700", marginBottom: sp[2] }}>What goes with it</Text>
                  <Ledger>
                    {d.going.shifts ? <LedgerRow label={`Shifts${d.going.span ? `  ${d.going.span}` : ""}`} value={String(d.going.shifts)} /> : null}
                    {d.going.shifts ? <LedgerRow label="Hours on them" value={d.going.worked.hm} /> : null}
                    {d.going.breaks ? <LedgerRow label="Breaks inside them" value={String(d.going.breaks)} /> : null}
                    {d.going.payments ? <LedgerRow label="Payments marked received" value={String(d.going.payments)} /> : null}
                  </Ledger>
                  <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginTop: sp[3] }}>All of it is deleted for good. Your other jobs and their hours are untouched — this only ever takes what was recorded at {d.workplace.name}.</Text>
                </>
              ) : (
                <Text style={{ color: t.muted, fontSize: 14 }}>Nothing has been recorded at {d.workplace.name} yet, so there is nothing to lose with it.</Text>
              )}
            </Card>
            <View style={{ gap: sp[3] }}>
              <Button title={d.going.shifts ? `Remove it and all ${d.going.shifts} shift${d.going.shifts === 1 ? "" : "s"}` : `Remove ${d.workplace.name}`} icon="trash-outline" kind="danger" onPress={remove} busy={busy} disabled={d.clocked_in} testID="confirm-remove" />
              <Button title="Keep it" kind="plain" onPress={goBack} />
            </View>
          </>
        ) : null}
      </Page>
    </Screen>
  );
}
