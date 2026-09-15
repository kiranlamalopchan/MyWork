/** Who reacted, and with what — for a notice, or one of its comments. */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { board } from "@/api";
import { Avatar, Empty, ErrorBanner, Loading, Screen } from "@/ui";
import { sp, useTheme } from "@/ui/theme";

export default function Reactions() {
  const t = useTheme();
  const router = useRouter();
  const { id, comment } = useLocalSearchParams<{ id: string; comment?: string }>();
  const q = useQuery({
    queryKey: ["reactors", id, comment || ""],
    queryFn: () => (comment ? board.commentReactors(Number(comment)) : board.reactors(Number(id))),
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4] }}>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data && q.data.total === 0 ? <Empty icon="happy-outline" title="No reactions yet" /> : null}
        {q.data?.groups.map((g) => (
          <View key={g.emoji} style={{ marginBottom: sp[4] }}>
            <Text style={[styles.head, { color: t.muted }]}>{g.emoji}  {g.people.length}</Text>
            {g.people.map((p) => (
              <Pressable key={p.username} onPress={() => router.push(`/people/${p.username}`)} style={styles.row}>
                <Avatar person={p} size={36} />
                <Text style={{ color: t.text, fontWeight: "600", fontSize: 15 }}>{p.is_me ? "You" : p.name}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { fontWeight: "700", fontSize: 14, marginBottom: sp[2] },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: 8 },
});
