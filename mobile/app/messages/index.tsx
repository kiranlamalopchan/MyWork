/**
 * Your conversations: one row per friend you have exchanged messages with,
 * the newest first, with what was last said and how many lines you have
 * not read. A new one is started from a friend's page.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { useChatThreads } from "@/api";
import { useT } from "@/i18n";
import { Avatar, Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen, usePullRefresh } from "@/ui";
import { SkeletonRows } from "@/ui/Skeleton";
import { sp, useTheme } from "@/ui/theme";

export default function Messages() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const q = useChatThreads();
  const refresh = usePullRefresh(q.refetch);
  const threads = q.data?.threads ?? [];

  return (
    <Screen back backLabel={tr("Alerts")}>
      <Page refreshControl={refresh}>
        <PageTitle sub={tr("Between you and your friends.")}>{tr("Messages")}</PageTitle>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRows count={4} /> : null}
        {q.data && threads.length === 0 ? (
          <Empty icon="mail-outline" title={tr("No messages yet")} sub={tr("Open a friend's page and tap Message to start one.")}
            action={<Button title={tr("Your friends")} icon="people-outline" onPress={() => router.push("/profile/friends")} />} />
        ) : null}
        {threads.length ? (
          <Card pad={false}>
            {threads.map((thread, i) => {
              const unread = thread.unread > 0;
              return (
                <Pressable key={thread.person.username}
                  onPress={() => router.push(`/messages/${encodeURIComponent(thread.person.username)}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={unread ? tr("{name}, {n} unread", { name: thread.person.name, n: thread.unread }) : thread.person.name}
                  testID={`thread-${thread.person.username}`}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1, borderBottomColor: t.line, borderBottomWidth: i === threads.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                  <Avatar person={thread.person} size={44} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: sp[2] }}>
                      <Text style={{ color: t.text, fontSize: 16, fontWeight: unread ? "800" : "600", flex: 1 }} numberOfLines={1}>{thread.person.name}</Text>
                      <Text style={{ color: t.muted, fontSize: 12 }}>{thread.last.day}</Text>
                    </View>
                    <Text style={{ color: unread ? t.text : t.muted, fontSize: 14, fontWeight: unread ? "600" : "400" }} numberOfLines={1}>
                      {thread.last.mine ? tr("You: {text}", { text: thread.last.body }) : thread.last.body}
                    </Text>
                  </View>
                  {unread ? (
                    <View style={[styles.badge, { backgroundColor: t.brand }]}>
                      <Text style={{ color: t.brandInk, fontSize: 12, fontWeight: "700" }}>{thread.unread > 99 ? "99+" : thread.unread}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </Card>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 68 },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});
