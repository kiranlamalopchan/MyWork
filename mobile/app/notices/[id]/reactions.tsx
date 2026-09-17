/** Who is behind the count (templates/noticeboard/reactors.html): the whole list, grouped by what each person left. */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { board } from "@/api";
import { Avatar, Card, Empty, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { SkeletonReactions } from "@/ui/Skeleton";
import { sp, useTheme } from "@/ui/theme";

export default function Reactions() {
  const t = useTheme();
  const router = useRouter();
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const q = useQuery({
    queryKey: ["reactors", id, comment || ""],
    queryFn: () => (comment ? board.commentReactors(Number(comment)) : board.reactors(Number(id))),
  });
  const total = q.data?.total ?? 0;

  return (
    <Screen back backLabel="Back">
      <Page>
        {q.data ? <PageTitle sub={comment ? "On a comment" : "On the notice"}>{total} reaction{total === 1 ? "" : "s"}</PageTitle> : null}
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonReactions /> : null}
        {q.data && total === 0 ? <Empty icon="happy-outline" title="No reactions yet" sub="Be the first — the faces are under the post." /> : null}
        {q.data?.groups.map((g) => (
          <Card key={g.emoji} pad={false}>
            <View style={[styles.head, { borderBottomColor: t.line }]}>
              <Text style={{ fontSize: 20 }}>{g.emoji}</Text>
              <Text style={{ color: t.text2, fontWeight: "700", fontSize: 15 }}>{g.people.length}</Text>
            </View>
            {g.people.map((p, i) => (
              <Pressable key={p.username} onPress={() => router.push(`/people/${p.username}`)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent", borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
                <Avatar person={p} size={32} live={false} />
                <Text style={{ color: t.text, fontWeight: "600", fontSize: 15, flex: 1 }}>
                  {p.username}{p.is_me ? <Text style={{ color: t.muted, fontWeight: "500" }}>  you</Text> : null}
                </Text>
                <Text style={{ fontSize: 18 }}>{g.emoji}</Text>
              </Pressable>
            ))}
          </Card>
        ))}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
});
