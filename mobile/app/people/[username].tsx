/** Somebody's page: who they are on the board, and what they have posted. */
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";

import { usePerson } from "@/api";
import { Avatar, Card, Empty, ErrorBanner, Loading, Screen } from "@/ui";
import { NoticeCard } from "@/ui/NoticeCard";
import { sp, useTheme } from "@/ui/theme";

export default function PersonScreen() {
  const t = useTheme();
  const navigation = useNavigation();
  const { username } = useLocalSearchParams<{ username: string }>();
  const q = usePerson(username);

  React.useEffect(() => {
    if (q.data) navigation.setOptions({ title: q.data.person.is_me ? "You" : q.data.person.name });
  }, [q.data?.person.name]);

  const stat = (n: number, label: string) => (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ color: t.text, fontWeight: "800", fontSize: 20 }}>{n}</Text>
      <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4], gap: sp[3] }}>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <Loading /> : null}
        {q.data ? (
          <>
            <Card>
              <View style={styles.who}>
                <Avatar person={q.data.person} size={64} />
                <View>
                  <Text style={{ color: t.text, fontWeight: "800", fontSize: 20 }}>{q.data.person.name}</Text>
                  <Text style={{ color: t.muted }}>@{q.data.person.username}{q.data.person.is_live ? " · here now" : ""}</Text>
                </View>
              </View>
              <View style={styles.stats}>
                {stat(q.data.notice_count, "notices")}
                {stat(q.data.comment_count, "comments")}
                {stat(q.data.received, "reactions")}
                {stat(q.data.given, "given")}
              </View>
            </Card>
            {q.data.notices.length === 0 ? <Empty icon="chatbubble-outline" title="Nothing posted yet" /> : q.data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: sp[4] },
  stats: { flexDirection: "row", marginTop: sp[4], paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(128,128,128,0.25)" },
});
