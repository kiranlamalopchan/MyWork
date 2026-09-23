/**
 * The whole board (templates/noticeboard/board.html): newest first, a page
 * at a time as you scroll. Above the cards, a prompt in your own face's
 * name — "Share something…" — which is the way to post.
 */
import React, { useCallback, useRef } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useBoard, type Notice } from "@/api";
import { useSession } from "@/auth/session";
import { Avatar, Card, Empty, ErrorBanner, Screen, usePullRefresh } from "@/ui";
import { SkeletonNotice, SkeletonNotices } from "@/ui/Skeleton";
import { RevealProvider, useKeyboardScroll } from "@/ui/keyboard";
import { useLayout } from "@/ui/layout";
import { NoticeCard } from "@/ui/NoticeCard";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Board() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const { me } = useSession();
  const q = useBoard();
  const refresh = usePullRefresh(q.refetch);
  const notices = q.data?.pages.flatMap((p) => p.results) ?? [];
  const total = q.data?.pages[0]?.count ?? 0;
  const list = useRef<FlatList<Notice>>(null);
  const keyboard = useKeyboardScroll(useCallback((y: number) => list.current?.scrollToOffset({ offset: y, animated: true }), []));

  return (
    <Screen back backLabel="Home">
      <RevealProvider value={keyboard.reveal}>
        <FlatList
          showsVerticalScrollIndicator={false}
          ref={list}
          data={notices}
          keyExtractor={(n) => String(n.id)}
          renderItem={({ item }) => <NoticeCard notice={item} />}
          contentContainerStyle={[layout.column, { paddingTop: sp[3], gap: sp[4], paddingBottom: layout.bottom + sp[6] }]}
          keyboardShouldPersistTaps="handled"
          onScroll={keyboard.onScroll}
          scrollEventThrottle={32}
          refreshControl={refresh}
          onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={
            <View style={{ gap: sp[4] }}>
              <View style={styles.head}>
                <Text style={[styles.title, { color: t.text }]}>Notice board</Text>
                <Text style={[styles.sub, { color: t.muted }]}>{total ? `${total} notice${total === 1 ? "" : "s"} · everyone signed in sees them` : "Everyone signed in sees what is posted here"}</Text>
              </View>
              {me ? (
                <Card pad={false} style={styles.prompt} onPress={() => router.push("/notices/compose")} testID="post-button">
                  <Avatar person={me} size={40} live={false} />
                  <View style={[styles.promptBox, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
                    <Text style={[styles.promptText, { color: t.muted }]} numberOfLines={1}>Share something…</Text>
                  </View>
                  <View style={[styles.promptGo, { backgroundColor: t.brand }]} accessibilityLabel="Post">
                    <Ionicons name="pencil" size={17} color={t.brandInk} />
                  </View>
                </Card>
              ) : null}
              {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
            </View>
          }
          ListEmptyComponent={q.isLoading ? <View style={{ gap: sp[4] }}><SkeletonNotices count={3} /></View> : <Empty icon="chatbubble-outline" title="Nothing on the board" sub="Post the first notice — everyone signed in will see it." />}
          ListFooterComponent={q.isFetchingNextPage ? <SkeletonNotice lines={2} /> : null}
        />
      </RevealProvider>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingTop: sp[3], gap: 2 },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 35 },
  sub: { fontSize: 14.5, lineHeight: 20 },
  prompt: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.xl },
  promptBox: { flex: 1, minWidth: 0, height: 42, borderRadius: radius.pill, paddingHorizontal: sp[4], justifyContent: "center" },
  promptText: { fontSize: 15 },
  promptGo: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
});
