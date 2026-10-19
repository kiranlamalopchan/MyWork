/**
 * The whole board (templates/noticeboard/board.html): newest first, a page
 * at a time as you scroll after opening the two-notice fold. The Post
 * control sits beside the heading, as it does on the website.
 */
import React, { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useBoard, type Notice } from "@/api";
import { Empty, ErrorBanner, Screen, usePullRefresh } from "@/ui";
import { underRefresh, WithDepth } from "@/ui/depth";
import { SkeletonNotice, SkeletonNotices } from "@/ui/Skeleton";
import { RevealProvider, useKeyboardScroll } from "@/ui/keyboard";
import { useLayout } from "@/ui/layout";
import { NoticeCard } from "@/ui/NoticeCard";
import { NoticeFold } from "@/ui/NoticeFold";
import { radius, sp, useTheme } from "@/ui/theme";

export default function Board() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const q = useBoard();
  const refresh = usePullRefresh(q.refetch);
  const notices = q.data?.pages.flatMap((p) => p.results) ?? [];
  const total = q.data?.pages[0]?.count ?? 0;
  const [expanded, setExpanded] = useState(false);
  const list = useRef<FlatList<Notice>>(null);
  const keyboard = useKeyboardScroll(useCallback((y: number) => list.current?.scrollToOffset({ offset: y, animated: true }), []));

  return (
    <Screen back backLabel="Home">
      <RevealProvider value={keyboard.reveal}>
        <WithDepth>{(under) => <FlatList
          showsVerticalScrollIndicator={false}
          {...under.scroll}
          ref={list}
          data={expanded ? notices : notices.slice(0, 2)}
          keyExtractor={(n) => String(n.id)}
          renderItem={({ item }) => <NoticeCard notice={item} />}
          contentContainerStyle={[layout.column, { paddingTop: sp[3] + under.padTop, gap: sp[4], paddingBottom: layout.bottom + sp[6] }]}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => { keyboard.onScroll(e); under.onScroll(e); }}
          scrollEventThrottle={16}
          refreshControl={underRefresh(refresh, under)}
          onEndReached={() => expanded && q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={
            <View style={{ gap: sp[4] }}>
              <View style={styles.head}>
                <Text style={[styles.title, { color: t.text }]}>Notice board</Text>
                <Pressable onPress={() => router.push("/notices/compose")} accessibilityRole="button" accessibilityLabel="Post a notice" testID="post-button" style={({ pressed }) => [styles.post, { backgroundColor: t.brand, opacity: pressed ? 0.8 : 1 }]}>
                  <Ionicons name="add" size={20} color={t.brandInk} />
                  <Text style={{ color: t.brandInk, fontWeight: "700", fontSize: 14 }}>Post</Text>
                </Pressable>
              </View>
              {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
            </View>
          }
          ListEmptyComponent={q.isLoading ? <View style={{ gap: sp[4] }}><SkeletonNotices count={3} /></View> : <Empty icon="chatbubble-outline" title="Nothing on the board" sub="Post the first notice — everyone signed in will see it." />}
          ListFooterComponent={<View style={{ gap: sp[3] }}>
            {notices.length > 2 || total > 2 ? <NoticeFold expanded={expanded} count={Math.max(notices.length, total) - 2} onPress={() => {
              setExpanded(value => !value);
              if (expanded) list.current?.scrollToOffset({ offset: 0, animated: true });
              else if (notices.length <= 2 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
            }} /> : null}
            {expanded && q.isFetchingNextPage ? <SkeletonNotice lines={2} /> : null}
          </View>}
        />}</WithDepth>
      </RevealProvider>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingVertical: sp[3], flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[3] },
  title: { flex: 1, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, lineHeight: 34 },
  post: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: sp[4], borderRadius: radius.pill },
});
