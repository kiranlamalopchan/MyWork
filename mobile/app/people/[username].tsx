/**
 * Somebody's page (templates/noticeboard/person.html): who they are on the
 * board — four tallies — and what they have posted.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { usePerson } from "@/api";
import { Avatar, Card, Empty, ErrorBanner, Page, Screen } from "@/ui";
import { SkeletonPerson } from "@/ui/Skeleton";
import { NoticeCard } from "@/ui/NoticeCard";
import { sp, useTheme } from "@/ui/theme";

export default function PersonScreen() {
  const t = useTheme();
  const { username } = useLocalSearchParams<{ username: string }>();
  const q = usePerson(username);

  const stat = (n: number, label: string) => (
    <Card key={label} pad={false} style={styles.stat}>
      <Text style={{ color: t.text, fontWeight: "700", fontSize: 24, letterSpacing: -0.5 }}>{n}</Text>
      <Text style={{ color: t.muted, fontSize: 14.5 }}>{label}</Text>
    </Card>
  );

  return (
    <Screen back backLabel="Notice board">
      <Page>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonPerson /> : null}
        {q.data ? (
          <>
            <View style={styles.who}>
              <Avatar person={q.data.person} size={72} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontWeight: "700", fontSize: 24, letterSpacing: -0.4 }}>{q.data.person.is_me ? "You" : q.data.person.username}</Text>
                <Text style={{ color: t.muted, fontSize: 15 }}>On MeroKaam since {q.data.since}{q.data.person.is_live ? " · here now" : ""}</Text>
              </View>
            </View>
            <View style={styles.grid}>
              {stat(q.data.notice_count, q.data.notice_count === 1 ? "notice" : "notices")}
              {stat(q.data.comment_count, q.data.comment_count === 1 ? "comment" : "comments")}
              {stat(q.data.received, "reactions received")}
              {stat(q.data.given, "reactions given")}
            </View>
            <View style={styles.head}>
              <Ionicons name="chatbubble-outline" size={18} color={t.brand} />
              <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 }}>{q.data.person.is_me ? "Your notices" : "Their notices"}</Text>
            </View>
            {q.data.notices.length === 0 ? <Empty icon="chatbubble-outline" title="Nothing posted yet" /> : q.data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingTop: sp[4] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  stat: { width: "47%", flexGrow: 1, padding: sp[4], gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[2] },
});
