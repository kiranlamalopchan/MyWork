/**
 * The hub: a greeting, the next public holiday, the row of stories, then
 * the notice board with its newest few and the way to the rest. PLU and
 * TimeSheet are tabs of the bar below, so no tiles for them here.
 */
import React from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useHome, type HolidayCard } from "@/api";
import { useSession } from "@/auth/session";
import { Card, ErrorBanner, Loading, Page, Screen } from "@/ui";
import { NoticeCard } from "@/ui/NoticeCard";
import { StoriesTray } from "@/ui/StoriesTray";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const { data, isLoading, error, refetch, isRefetching } = useHome();

  return (
    <Screen>
      <Page refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.brand} />}>
        <View style={styles.greet}>
          <Text style={[styles.hello, { color: t.muted }]}>{greeting()}</Text>
          <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{me?.display_name || me?.username || "there"}</Text>
        </View>
        {error ? <ErrorBanner message={(error as Error).message} onRetry={refetch} /> : null}
        {isLoading ? <Loading /> : null}
        {data ? (
          <>
            {data.holiday.holiday ? <Holiday card={data.holiday.holiday} state={data.holiday.state} /> : null}

            <StoriesTray rows={data.stories} />

            <View style={styles.board}>
              <View style={styles.boardHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.boardTitle, { color: t.text }]}>Notice board</Text>
                  {data.notice_total ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }}>{data.notice_total} notice{data.notice_total === 1 ? "" : "s"}</Text> : null}
                </View>
                <Pressable onPress={() => router.push("/notices/compose")} testID="post-button" style={({ pressed }) => [styles.post, { backgroundColor: t.brand, transform: [{ scale: pressed ? 0.95 : 1 }] }, glow(t.brand)]}>
                  <Ionicons name="add" size={18} color={t.brandInk} />
                  <Text style={{ color: t.brandInk, fontWeight: "700", fontSize: 14 }}>Post</Text>
                </Pressable>
              </View>
              {data.notices.length === 0 ? (
                <Card><Text style={{ color: t.muted, textAlign: "center", fontSize: 14.5 }}>Nothing on the board — post the first notice; everyone signed in will see it.</Text></Card>
              ) : data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
              {data.notice_total > data.notices.length ? (
                <Pressable onPress={() => router.push("/board")} style={styles.more} testID="see-all">
                  <Text style={{ color: t.brandStrong, fontWeight: "700", fontSize: 14.5 }}>See all {data.notice_total} notices</Text>
                  <Ionicons name="chevron-forward" size={15} color={t.brandStrong} />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

const glow = (colour: string) => ({ shadowColor: colour, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 });

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** The next public holiday: a deep-green hero, the date as a tile beside the name. */
export function Holiday({ card, state }: { card: HolidayCard; state: string }) {
  const t = useTheme();
  const router = useRouter();
  const ink = t.heroInk, soft = t.heroSoft, chip = t.heroChip;
  return (
    <Pressable onPress={() => router.push("/holidays")} testID="holiday-card" style={({ pressed }) => [styles.hero, { backgroundColor: t.hero }, glow(t.brand), { transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
      <View style={[styles.orb, { backgroundColor: "rgba(255,255,255,0.08)" }]} />
      <View style={styles.hHead}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="calendar" size={14} color={soft} />
          <Text style={[styles.kicker, { color: soft }]}>Next public holiday</Text>
        </View>
        <Text style={[styles.pill, { backgroundColor: chip, color: ink }]}>{card.scope || state}</Text>
      </View>
      <View style={styles.hBody}>
        <View style={[styles.date, { backgroundColor: "rgba(255,255,255,0.16)" }]}>
          <Text style={[styles.month, { color: soft }]}>{card.month_short.toUpperCase()}</Text>
          <Text style={[styles.day, { color: ink }]}>{card.day}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.hName, { color: ink }]}>{card.name}</Text>
          <Text style={{ color: soft, fontSize: 14.5, marginTop: 2 }}>{card.weekday}</Text>
        </View>
      </View>
      <View style={styles.hFoot}>
        <View style={[styles.countdown, { backgroundColor: chip }]}>
          <Ionicons name="time-outline" size={14} color={ink} />
          <Text style={{ color: ink, fontSize: 13, fontWeight: "700" }}>{card.countdown}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Text style={{ color: ink, fontSize: 13.5, fontWeight: "700" }}>Full calendar</Text>
          <Ionicons name="chevron-forward" size={15} color={ink} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  greet: { paddingTop: sp[2] },
  hello: { fontSize: 15, fontWeight: "600" },
  name: { fontSize: 32, fontWeight: "800", letterSpacing: -1, lineHeight: 38 },
  hero: { borderRadius: radius.xl, padding: sp[5], overflow: "hidden" },
  orb: { position: "absolute", right: -50, top: -60, width: 190, height: 190, borderRadius: 95 },
  hHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2] },
  kicker: { fontSize: 11.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, overflow: "hidden" },
  hBody: { flexDirection: "row", alignItems: "center", gap: sp[4], marginTop: sp[4] },
  date: { width: 64, paddingTop: sp[2], paddingBottom: 10, alignItems: "center", gap: 1, borderRadius: radius.md },
  month: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9 },
  day: { fontSize: 30, fontWeight: "800", lineHeight: 32, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  hName: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  hFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: sp[2], marginTop: sp[4] },
  countdown: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  board: { gap: sp[3], marginTop: sp[2] },
  boardHead: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  boardTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  post: { flexDirection: "row", alignItems: "center", gap: 6, height: 42, paddingLeft: 12, paddingRight: sp[4], borderRadius: 999, marginLeft: sp[2] },
  more: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: sp[1] },
});
