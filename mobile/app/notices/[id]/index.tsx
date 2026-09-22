/**
 * One notice with its whole thread. The site shows a notice on the board
 * itself (/notices/?notice=<pk>); here it gets a page of its own, the same
 * card with nothing folded and the reply box at its foot.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { useNotice } from "@/api";
import { ErrorBanner, Page, Screen } from "@/ui";
import { SkeletonNotice } from "@/ui/Skeleton";
import { NoticeCard } from "@/ui/NoticeCard";

export default function NoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useNotice(Number(id));

  return (
    <Screen back title="Notice" backLabel="Board">
      <Page>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonNotice lines={4} comments={2} /> : null}
        {q.data ? <NoticeCard notice={q.data} full /> : null}
      </Page>
    </Screen>
  );
}
