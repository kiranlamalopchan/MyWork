/**
 * The hub: a greeting, the next public holiday, the row of stories, then
 * the notice board with its newest few and the way to the rest. PLU and
 * TimeSheet are tabs of the bar below, so no tiles for them here.
 *
 * On an iPad or a desktop window (useLayout().desk) the same three become
 * two columns, the way the site's home does from 1024px: the holiday and
 * the stories — the things you glance at — in a side column, the board —
 * the thing you read — beside it, at a width a line of text is still
 * comfortable at. The holiday card stacks, drawing above words, to suit
 * the narrow column.
 */
import React from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useHome, type HolidayCard } from "@/api";
import { useSession } from "@/auth/session";
import { Card, ErrorBanner, Page, Screen } from "@/ui";
import { HUB_SIDE, useLayout } from "@/ui/layout";
import { SkeletonHome } from "@/ui/Skeleton";
import { HolidayArt } from "@/ui/HolidayArt";
import { NoticeCard } from "@/ui/NoticeCard";
import { StoriesTray } from "@/ui/StoriesTray";
import { alpha, mix, radius, sp, useTheme } from "@/ui/theme";

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const { data, isLoading, error, refetch, isRefetching } = useHome();
  const layout = useLayout();
  const desk = layout.desk;

  return (
    <Screen>
      <Page refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.brand} />} contentContainerStyle={desk ? layout.hub : undefined}>
        <View style={styles.greet}>
          <Text style={[styles.hello, { color: t.muted }]}>{greeting()}</Text>
          <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{me?.display_name || me?.username || "there"}</Text>
        </View>
        {error ? <ErrorBanner message={(error as Error).message} onRetry={refetch} /> : null}
        {isLoading ? <SkeletonHome /> : null}
        {data ? (
          <View style={desk ? styles.hub : styles.stack}>
            <View style={desk ? styles.hubSide : styles.stack}>
              {data.holiday.holiday ? <Holiday card={data.holiday.holiday} state={data.holiday.state} stacked={desk} /> : null}

              <StoriesTray rows={data.stories} boxed={desk} />
            </View>

            <View style={[styles.board, desk && styles.hubMain]}>
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
          </View>
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

/**
 * The next public holiday (templates/holidays/_card.html): the day in words
 * on the left, a drawing of it on the right, on one mint-tinted panel.
 *
 * The drawing says nothing the words do not — it is here because this is the
 * first thing on the hub and the one thing on it that is good news, and four
 * fields and a chevron do not read that way. It gives up its width first.
 */
export function Holiday({ card, state, stacked = false }: { card: HolidayCard; state: string; stacked?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/holidays")} testID="holiday-card" style={({ pressed }) => [styles.hero, stacked && styles.heroStacked, { backgroundColor: mix(t.brand, t.surface, 0.1) }, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
      <View style={styles.hText}>
        <View style={styles.hHead}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="calendar" size={13} color={t.brandStrong} />
            <Text style={[styles.kicker, { color: t.brandStrong }]}>Public holiday</Text>
          </View>
          <Text style={[styles.pill, card.is_national ? { backgroundColor: alpha(t.brand, 0.18), color: t.brandStrong } : { backgroundColor: t.warnSoft, color: t.warn }]}>{card.scope || state}</Text>
        </View>
        <View style={styles.hBody}>
          <View style={[styles.date, { backgroundColor: t.surface, borderColor: alpha(t.brand, 0.22) }]}>
            <Text style={[styles.month, { color: t.brandStrong }]}>{card.month_short.toUpperCase()}</Text>
            <Text style={[styles.day, { color: t.text }]}>{card.day}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.hName, { color: t.text }]}>{card.name}</Text>
            <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }}>{card.weekday}</Text>
          </View>
        </View>
        {/* The countdown before the way in: it is the reason the card exists,
            and everything above it is only which holiday it is about. */}
        <View style={styles.hFoot}>
          <View style={[styles.countdown, { backgroundColor: t.warnSoft }]}>
            <Ionicons name="time-outline" size={13} color={t.warn} />
            <Text style={{ color: t.warn, fontSize: 12.5, fontWeight: "700" }}>{card.countdown}</Text>
          </View>
          <View style={[styles.cta, { backgroundColor: t.surface, borderColor: alpha(t.brand, 0.2) }]}>
            <Text style={{ color: t.brandStrong, fontSize: 13, fontWeight: "700" }}>Full calendar</Text>
            <Ionicons name="chevron-forward" size={14} color={t.brandStrong} />
          </View>
        </View>
      </View>
      {/* Bled into the padding on the right so it meets the card's edge —
          and, stacked, into the top as well, above the words. */}
      <View style={[styles.hArt, stacked && styles.hArtStacked]}><HolidayArt /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  greet: { paddingTop: sp[2] },
  hello: { fontSize: 15, fontWeight: "600" },
  name: { fontSize: 32, fontWeight: "800", letterSpacing: -1, lineHeight: 38 },
  hero: { flexDirection: "row", alignItems: "center", gap: sp[3], borderRadius: radius.xl, padding: sp[4], overflow: "hidden" },
  heroStacked: { flexDirection: "column-reverse", alignItems: "stretch" },
  hText: { flex: 1, minWidth: 0, gap: sp[3] },
  // A bit over a third, and never a stamp: the name is what has to stay
  // readable, so the drawing is the part that gives way on a narrow phone.
  hArt: { width: "36%", minWidth: 112, maxWidth: 180, aspectRatio: 160 / 150, marginRight: -sp[4] },
  hArtStacked: { width: 168, maxWidth: 168, alignSelf: "flex-end", marginTop: -sp[4] },
  // The page as a stack of sections, and as the two columns of a wide hub.
  stack: { gap: sp[4] },
  hub: { flexDirection: "row", alignItems: "flex-start", gap: 40 },
  hubSide: { width: HUB_SIDE, gap: sp[4] },
  hubMain: { flex: 1, minWidth: 0, marginTop: 0 },
  hHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: sp[2] },
  kicker: { fontSize: 11, fontWeight: "700", letterSpacing: 0.55, textTransform: "uppercase" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, overflow: "hidden" },
  hBody: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  date: { width: 52, paddingTop: 5, paddingBottom: 7, alignItems: "center", gap: 1, borderRadius: radius.md, borderWidth: 1 },
  month: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  day: { fontSize: 22, fontWeight: "700", lineHeight: 25, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  hName: { fontSize: 19, fontWeight: "800", letterSpacing: -0.4, lineHeight: 22 },
  hFoot: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: sp[2] },
  countdown: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  cta: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1 },
  board: { gap: sp[3], marginTop: sp[2] },
  boardHead: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  boardTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  post: { flexDirection: "row", alignItems: "center", gap: 6, height: 42, paddingLeft: 12, paddingRight: sp[4], borderRadius: 999, marginLeft: sp[2] },
  more: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: sp[1] },
});
