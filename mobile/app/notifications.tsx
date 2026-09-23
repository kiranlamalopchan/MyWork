/**
 * The bell (templates/notifications/inbox.html): everything that has been
 * said to you, newest first, a card per row washed in the colour of whoever
 * caused it while unread, under a pill for the day. Opening the page is
 * what marks it read; the rows that were unread when you arrived still
 * show as unread, because that is what you came to see.
 */
import React, { useCallback, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { inbox, useInbox, useInboxChanged, type Notification } from "@/api";
import { navigateTo } from "@/nav/paths";
import { Avatar, Button, Card, Empty, ErrorBanner, PageTitle, Screen, usePullRefresh } from "@/ui";
import { SkeletonNotifications } from "@/ui/Skeleton";
import { useLayout } from "@/ui/layout";
import { hsl, sp, useTheme } from "@/ui/theme";

const ICONS: Record<Notification["kind"], keyof typeof Ionicons.glyphMap> = {
  notice: "chatbubble-outline", comment: "chatbubbles-outline", reply: "return-down-forward-outline", reaction: "happy-outline", timesheet: "time-outline",
  story: "camera-outline", friend_request: "person-add-outline", friend_accepted: "people-outline",
};

export default function Inbox() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const q = useInbox();
  const refresh = usePullRefresh(q.refetch);
  const changed = useInboxChanged();
  const rows = q.data?.pages.flatMap((p) => p.results) ?? [];
  // What was unread when you arrived stays lit until you leave.
  const wasUnread = useRef(new Set<number>());
  rows.forEach((n) => { if (!n.read) wasUnread.current.add(n.id); });

  useFocusEffect(useCallback(() => {
    const unread = q.data?.pages[0]?.unread ?? 0;
    if (unread) inbox.readAll().then(() => changed()).catch(() => {});
    return () => { wasUnread.current.clear(); };
  }, [q.data?.pages[0]?.unread]));

  const open = async (n: Notification) => {
    try {
      const { url } = await inbox.read(n.id);
      changed();
      await navigateTo(url);
    } catch { /* the row stays */ }
  };

  const day = (iso: string) => {
    const d = new Date(iso), now = new Date();
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(d, y)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };

  return (
    <Screen back backLabel="Home">
      <FlatList
        showsVerticalScrollIndicator={false}
        data={rows}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={[layout.column, { paddingTop: sp[4], paddingBottom: layout.bottom + sp[6] }]}
        refreshControl={refresh}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={
          <>
            <PageTitle>Notifications</PageTitle>
            {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
          </>
        }
        ListEmptyComponent={q.isLoading ? <SkeletonNotifications /> : (
          <View style={{ marginTop: sp[3] }}>
            <Empty
              icon="notifications-outline"
              title="Nothing yet"
              sub="When somebody posts to the board, answers you, or reacts to something you wrote, it turns up here."
              action={<Button title="Open the board" icon="chatbubble-outline" onPress={() => router.push("/board")} />}
            />
          </View>
        )}
        renderItem={({ item, index }) => {
          const heading = index === 0 || day(item.created) !== day(rows[index - 1].created) ? day(item.created) : null;
          const unread = wasUnread.current.has(item.id);
          const from = !!item.actor;
          const titleInk = t.text;
          return (
            <>
              {heading ? (
                <View style={[styles.day, { marginTop: index === 0 ? sp[1] : sp[5] }]}>
                  <Text style={{ color: t.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.4 }}>{heading}</Text>
                </View>
              ) : null}
              <Card pad={false} style={{ marginBottom: sp[2] }}>
                <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.8 : 1 }]}>
                  <View>
                    {item.actor ? (
                      <Avatar person={item.actor} size={40} live={false} ring={unread ? `hsla(${item.hue}, 72%, 52%, 0.22)` : undefined} />
                    ) : (
                      <View style={[styles.mark, { backgroundColor: t.brandSoft }]}>
                        <Ionicons name="time-outline" size={18} color={t.brand} />
                      </View>
                    )}
                    {item.actor ? (
                      item.emoji ? (
                        <View style={[styles.kind, { backgroundColor: t.surface }]}><Text style={{ fontSize: 13 }}>{item.emoji}</Text></View>
                      ) : (
                        <View style={[styles.kind, { backgroundColor: unread ? hsl(item.hue, 72, 52) : t.pill }]}>
                          <Ionicons name={ICONS[item.kind] || "notifications-outline"} size={11} color={unread ? "#fff" : t.text2} />
                        </View>
                      )
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[styles.title, { color: titleInk, fontWeight: unread ? "800" : "600" }]}>{item.title}</Text>
                    {item.body ? <Text style={{ color: t.text2, fontSize: 14, lineHeight: 20 }} numberOfLines={2}>{item.body}</Text> : null}
                    <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{item.ago}</Text>
                  </View>
                  {unread ? (
                    <View style={[styles.dotRing, { backgroundColor: from ? `hsla(${item.hue}, 72%, 52%, 0.18)` : t.brandSoft }]}>
                      <View style={[styles.dot, { backgroundColor: from ? hsl(item.hue, 72, 52) : t.brand }]} />
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={t.lineStrong} style={{ marginTop: 5 }} />
                  )}
                </Pressable>
              </Card>
            </>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { marginBottom: sp[3], paddingHorizontal: 2 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: sp[3], padding: sp[4] },
  mark: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  kind: { position: "absolute", right: -3, bottom: -3, width: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, letterSpacing: -0.2, lineHeight: 20 },
  dotRing: { width: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", marginTop: 3 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
