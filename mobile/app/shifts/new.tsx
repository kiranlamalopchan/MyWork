/** Add a shift online, or queue a dated draft for a safe, idempotent retry. */
import React, { useEffect, useMemo } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { timesheet, useTimesheetChanged, type NewShift as Options } from "@/api";
import { ApiError } from "@/api/client";
import { goBack } from "@/nav/paths";
import { ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonForm } from "@/ui/Skeleton";
import { ShiftForm } from "@/ui/ShiftForm";
import { usePrivateScope, usePrivateState, writePrivate } from "@/storage/private";
import { queueShift } from "@/offline/shifts";
import { notify } from "@/ui/confirm";
import { useTheme } from "@/ui/theme";

export default function NewShift() {
  const router = useRouter(), t = useTheme();
  const scope = usePrivateScope();
  const { day, draft: draftName } = useLocalSearchParams<{ day?: string; draft?: string }>();
  const draftKey = draftName || day || "new";
  const q = useQuery({ queryKey: ["shift-new", day || ""], queryFn: () => timesheet.newShift(day) });
  const [cached, setCached, loaded] = usePrivateState<Options | null>("shift-options", null);
  const initialId = useMemo(() => randomUUID(), []);
  const [clientId, setClientId, idReady] = usePrivateState(`shift-submission:${draftKey}`, initialId);
  useEffect(() => { if (q.data) setCached(q.data); }, [q.data, setCached]);
  // Persist the identifier before a request can outlive this screen or process.
  useEffect(() => { if (idReady) setClientId(clientId); }, [idReady, clientId, setClientId]);
  const options = q.data || cached;
  const today = new Date();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const fallbackDay = day || localDay;
  const changed = useTimesheetChanged();
  return <Screen back backLabel="Timesheet"><Page>
    <PageTitle sub="Drafts stay on this device. If the connection drops, a queued shift is retried without creating it twice.">Add a shift</PageTitle>
    {q.error && !options ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
    {q.error && options ? <Text style={{ color: t.muted }}>Using saved workplace choices. Check the times before saving.</Text> : null}
    {(!loaded || !idReady || (!options && q.isLoading)) ? <SkeletonForm fields={4} /> : null}
    {loaded && idReady && options ? <ShiftForm
      draftKey={`shift:new:${draftKey}`}
      workplaces={options.workplaces}
      initial={{ workplace: options.workplace ?? "", clock_in: day || !q.data ? `${fallbackDay}T09:00` : options.clock_in, clock_out: day || !q.data ? `${fallbackDay}T17:00` : options.clock_out, note: "", breaks: [] }}
      editing={false}
      onSave={async input => {
        // Keep the same identifier if the process exits after the server saves.
        if (scope) await writePrivate(scope, `shift-submission:${draftKey}`, clientId);
        const submission = { ...input, client_id: clientId };
        try {
          const shift = await timesheet.addShift(submission);
          setClientId(randomUUID()); changed(); router.replace(`/shifts/${shift.id}`);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 0 || !scope || !options.supports_offline_drafts) throw error;
          await queueShift(scope, submission);
          setClientId(randomUUID());
          notify("Shift saved on this device", "It will sync when the connection returns. You can review it under Profile → Offline shifts.");
          goBack();
        }
      }}
      onCancel={goBack}
    /> : null}
  </Page></Screen>;
}
