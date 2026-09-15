/** The whole board, newest first, a page at a time as you scroll. */
import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useBoard } from "@/api";
import { Empty, ErrorBanner, Loading, Screen } from "@/ui";
import { NoticeCard } from "@/ui/NoticeCard";
import { sp, useTheme } from "@/ui/theme";

export default function Board() {
  const t = useTheme();
  const router = useRouter();
  const q = useBoard();
  const notices = q.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <Screen>
      <FlatList
        data={notices}
        keyExtractor={(n) => String(n.id)}
        renderItem={({ item }) => <NoticeCard notice={item} />}
        contentContainerStyle={{ padding: sp[4], gap: sp[3], paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={q.refetch} tintColor={t.brand} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        onEndReachedThreshold={0.6}
        ListHeaderComponent={q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        ListEmptyComponent={q.isLoading ? <Loading /> : <Empty icon="chatbubbles-outline" title="Nothing on the board" sub="Post the first notice — everyone signed in will see it." />}
        ListFooterComponent={q.isFetchingNextPage ? <Loading /> : null}
      />
      <Pressable onPress={() => router.push("/notices/compose")} style={[styles.fab, { backgroundColor: t.brand }]} accessibilityLabel="Post a notice" testID="post-fab">
        <Ionicons name="add" size={28} color={t.brandInk} />
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fab: { position: "absolute", right: sp[4], bottom: sp[4], width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
