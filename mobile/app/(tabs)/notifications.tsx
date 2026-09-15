/** The bell: everything you have been told, newest first; a tap follows it. */
import React, { useCallback } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { inbox, useInbox, useInboxChanged, type Notification } from "@/api";
import { navigateTo } from "@/nav/paths";
import { Avatar, Empty, ErrorBanner, Loading, Screen } from "@/ui";
import { hsl, sp, useTheme } from "@/ui/theme";

const ICONS: Record<Notification["kind"], keyof typeof Ionicons.glyphMap> = {
  notice: "chatbubble-outline", comment: "chatbubbles-outline", reply: "return-down-forward-outline", reaction: "happy-outline", timesheet: "time-outline",
};

export default function Inbox() {
  const t = useTheme();
  const q = useInbox();
  const changed = useInboxChanged();
  const rows = q.data?.pages.flatMap((p) => p.results) ?? [];

  // Opening the inbox is what marks it read — as on the site.
  useFocusEffect(useCallback(() => {
    const unread = q.data?.pages[0]?.unread ?? 0;
    if (unread) inbox.readAll().then(() => changed()).catch(() => {});
  }, [q.data?.pages[0]?.unread]));

  const open = async (n: Notification) => {
    try {
      const { url } = await inbox.read(n.id);
      changed();
      await navigateTo(url);
    } catch {
      /* the row stays; nothing to do */
    }
  };

  const day = (iso: string) => {
    const d = new Date(iso), now = new Date();
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    if (same(d, now)) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(d, y)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  };

  return (
    <Screen>
      <FlatList
        data={rows}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={{ paddingVertical: sp[2] }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={q.refetch} tintColor={t.brand} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        ListEmptyComponent={q.isLoading ? <Loading /> : <Empty icon="notifications-off-outline" title="Nothing yet" sub="When somebody posts to the board or answers you, it lands here." />}
        renderItem={({ item, index }) => {
          const heading = index === 0 || day(item.created) !== day(rows[index - 1].created) ? day(item.created) : null;
          return (
            <>
              {heading ? <Text style={[styles.day, { color: t.muted }]}>{heading}</Text> : null}
              <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent" }]}>
                {item.actor ? <Avatar person={item.actor} size={40} live={false} /> : (
                  <View style={[styles.glyph, { backgroundColor: hsl(item.hue) }]}>
                    <Ionicons name={ICONS[item.kind] || "notifications-outline"} size={18} color="#fff" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: item.read ? "500" : "700", fontSize: 15 }}>{item.emoji ? `${item.emoji} ` : ""}{item.title}</Text>
                  {item.body ? <Text style={{ color: t.text2, fontSize: 14 }} numberOfLines={2}>{item.body}</Text> : null}
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{item.ago}</Text>
                </View>
                {!item.read ? <View style={[styles.unread, { backgroundColor: t.brand }]} /> : null}
              </Pressable>
            </>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: sp[4], paddingTop: sp[3], paddingBottom: sp[1] },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
  glyph: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  unread: { width: 9, height: 9, borderRadius: 5 },
});
