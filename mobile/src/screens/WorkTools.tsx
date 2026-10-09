/**
 * Work settings preserves past-shift entry, pay and workplace management.
 * Rates, hours restrictions and pay cycles remain in Workplaces.
 */
import { WorkNavigation } from "@/ui/WorkNavigation";
import React from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useMore } from "@/api";
import { useSession } from "@/auth/session";
import { Card, ErrorBanner, MenuRow, Page, PageTitle, Screen, SectionLabel, useLayout, usePullRefresh } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

type Way = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  value?: string;
  tint: string;
  to: string;
  testID: string;
};

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { wide } = useLayout();
  const { me } = useSession();
  const q = useMore();
  const refresh = usePullRefresh(q.refetch);
  const d = q.data;

  // Until the figures land the rows still say what they are for, rather than
  // holding a space where a number will be.
  const owed = d?.unpaid_total.seconds ? d.unpaid_total.hm : undefined;
  const ways: Way[] = [
    {
      key: "shift", icon: "time", title: "Add a past shift", tint: t.violet,
      sub: "For a day you forgot to clock in", to: "/shifts/new", testID: "more-add-shift",
    },
    {
      key: "pay", icon: "cash", title: "Pay", tint: t.orange, value: owed,
      sub: d ? (owed ? "Owed across your jobs" : "Nothing outstanding") : "What you are owed",
      to: "/pay", testID: "more-pay",
    },
    {
      key: "places", icon: "business", title: "Workplaces", tint: t.blue,
      value: d?.workplace_count ? String(d.workplace_count) : undefined,
      sub: d && !d.workplace_count ? "Add the places you work" : "Rates, caps and cycles",
      to: "/workplaces", testID: "more-workplaces",
    },
  ];

  return (
    <Screen section="Work">
      <Page refreshControl={refresh}>
        <WorkNavigation active="settings" />
        <PageTitle sub={`Rates, hours restrictions and workplaces for ${me?.username ?? "you"}`}>Work settings</PageTitle>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        <SectionLabel>Manage your work</SectionLabel>
        {wide ? (
          <View style={styles.grid}>
            {ways.map((w) => (
              <MenuRow key={w.key} stacked icon={w.icon} title={w.title} sub={w.sub} value={w.value} tint={w.tint} onPress={() => router.push(w.to as never)} testID={w.testID} />
            ))}
          </View>
        ) : (
          <Card pad={false}>
            {ways.map((w, i) => (
              <MenuRow key={w.key} icon={w.icon} title={w.title} sub={w.sub} value={w.value} tint={w.tint} last={i === ways.length - 1} onPress={() => router.push(w.to as never)} testID={w.testID} />
            ))}
          </Card>
        )}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The tiles wrap rather than being told how many fit: three across a
  // tablet, two across a phone on its side, and each one still readable.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
});
