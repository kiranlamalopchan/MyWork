/**
 * More (templates/timeclock/more.html): the TimeSheet's back rooms — a past
 * shift the clock missed, what you are owed, and the places you work.
 */
import React from "react";
import { RefreshControl } from "react-native";
import { useRouter } from "expo-router";

import { useMore } from "@/api";
import { useSession } from "@/auth/session";
import { Card, ErrorBanner, MenuRow, Page, PageTitle, Screen } from "@/ui";
import { useTheme } from "@/ui/theme";

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const q = useMore();
  const d = q.data;
  const owed = d ? (d.unpaid_total.seconds ? `${d.unpaid_total.hm} owed across your jobs` : "Nothing outstanding") : "What you are owed";
  const places = d ? (d.workplace_count ? `${d.workplace_count} saved · rates, caps and cycles` : "Add the places you work") : "Rates, caps and cycles";

  return (
    <Screen>
      <Page refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={t.brand} />}>
        <PageTitle sub={`TimeSheet settings for ${me?.username ?? "you"}`}>More</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        <Card pad={false}>
          <MenuRow icon="time" title="Add a past shift" sub="For a day you forgot to clock in" tint={t.violet} onPress={() => router.push("/shifts/new")} testID="more-add-shift" />
          <MenuRow icon="cash" title="Pay" sub={owed} tint={t.orange} onPress={() => router.push("/pay")} testID="more-pay" />
          <MenuRow icon="business" title="Workplaces" sub={places} tint={t.blue} onPress={() => router.push("/workplaces")} last testID="more-workplaces" />
        </Card>
      </Page>
    </Screen>
  );
}
