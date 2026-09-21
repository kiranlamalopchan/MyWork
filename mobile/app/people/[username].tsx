/**
 * Somebody's page (templates/noticeboard/person.html): who they are on the
 * board — four tallies — and what they have posted. And, since a shared
 * wall needs it, the two ways to keep them at arm's length: report them,
 * or block them (after which neither of you sees the other).
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { safety, usePerson, useSafetyChanged } from "@/api";
import { AdminBadge, Avatar, Button, Card, Empty, ErrorBanner, Page, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { SkeletonPerson } from "@/ui/Skeleton";
import { NoticeCard } from "@/ui/NoticeCard";
import { ReportSheet, type ReportTarget } from "@/ui/ReportSheet";
import { sp, useTheme } from "@/ui/theme";

export default function PersonScreen() {
  const t = useTheme();
  const { username } = useLocalSearchParams<{ username: string }>();
  const q = usePerson(username);
  const changed = useSafetyChanged();
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const stat = (n: number, label: string) => (
    <Card key={label} pad={false} style={styles.stat}>
      <Text style={{ color: t.text, fontWeight: "700", fontSize: 24, letterSpacing: -0.5 }}>{n}</Text>
      <Text style={{ color: t.muted, fontSize: 14.5 }}>{label}</Text>
    </Card>
  );

  const block = () => confirm(`Block ${username}?`, "Neither of you will see the other's posts, comments or stories, and any friendship ends.", "Block", async () => {
    setBusy(true);
    try { await safety.block(username); changed(); q.refetch(); } catch (e: any) { notify("Couldn't block them", e?.message); } finally { setBusy(false); }
  });
  const unblock = async () => {
    setBusy(true);
    try { await safety.unblock(username); changed(); q.refetch(); } catch (e: any) { notify("Couldn't unblock them", e?.message); } finally { setBusy(false); }
  };

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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: t.text, fontWeight: "700", fontSize: 24, letterSpacing: -0.4, flexShrink: 1 }} numberOfLines={1}>{q.data.person.is_me ? "You" : q.data.person.username}</Text>
                  <AdminBadge person={q.data.person} size={12} />
                </View>
                <Text style={{ color: t.muted, fontSize: 15 }}>On KaamKoRecord since {q.data.since}{q.data.person.is_live ? " · here now" : ""}</Text>
              </View>
            </View>
            {!q.data.person.is_me ? (
              q.data.blocked ? (
                <Card tint={t.dangerSoft} style={styles.safety}>
                  <Ionicons name="ban-outline" size={20} color={t.danger} />
                  <Text style={{ flex: 1, color: t.text, fontSize: 14.5 }}>You've blocked {q.data.person.username}. Their posts are hidden.</Text>
                  <Button title="Unblock" size="sm" kind="plain" onPress={unblock} busy={busy} testID="person-unblock" />
                </Card>
              ) : (
                <View style={styles.safetyRow}>
                  <Button title="Report" size="sm" kind="plain" icon="flag-outline" onPress={() => setReporting({ kind: "user", id: q.data!.id, username: q.data!.person.username })} testID="person-report" />
                  <Button title="Block" size="sm" kind="danger" icon="ban-outline" onPress={block} busy={busy} testID="person-block" />
                </View>
              )
            ) : null}
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
            {q.data.notices.length === 0 ? <Empty icon="chatbubble-outline" title={q.data.blocked ? "Hidden while blocked" : "Nothing posted yet"} /> : q.data.notices.map((n) => <NoticeCard key={n.id} notice={n} />)}
          </>
        ) : null}
      </Page>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} onBlocked={() => q.refetch()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingTop: sp[4] },
  safety: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  safetyRow: { flexDirection: "row", gap: sp[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  stat: { width: "47%", flexGrow: 1, padding: sp[4], gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[2] },
});
