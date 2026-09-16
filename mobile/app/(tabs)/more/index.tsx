/**
 * More (templates/timeclock/more.html): the TimeSheet's back rooms — a past
 * shift the clock missed, what you are owed, and the places you work.
 *
 * Three ways in, each with the figure that answers it without being opened.
 * On a phone they are one list; from a tablet's width up they become tiles
 * across the page, because three rows down the left of a wide screen is
 * mostly empty screen.
 */
import React from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useMore } from "@/api";
import { useSession } from "@/auth/session";
import { Card, ErrorBanner, MenuRow, Page, PageTitle, Screen, SectionLabel, useLayout } from "@/ui";
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
    <Screen>
      <Page refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={t.brand} />}>
        <PageTitle sub={`TimeSheet settings for ${me?.username ?? "you"}`}>More</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        <SectionLabel>TimeSheet</SectionLabel>
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
