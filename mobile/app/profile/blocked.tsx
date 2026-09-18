/**
 * Everyone you have blocked, each with a way back. Neither of you sees the
 * other's posts, comments or stories while the block stands.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { safety, useBlocked, useSafetyChanged } from "@/api";
import { Avatar, Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen } from "@/ui";
import { notify } from "@/ui/confirm";
import { SkeletonRows } from "@/ui/Skeleton";
import { sp, useTheme } from "@/ui/theme";

export default function BlockedScreen() {
  const t = useTheme();
  const q = useBlocked();
  const changed = useSafetyChanged();
  const [busy, setBusy] = useState<string | null>(null);

  const unblock = async (username: string) => {
    setBusy(username);
    try { await safety.unblock(username); changed(); await q.refetch(); }
    catch (e: any) { notify("Couldn't unblock them", e?.message); }
    finally { setBusy(null); }
  };

  const people = q.data?.people ?? [];

  return (
    <Screen back backLabel="Profile">
      <Page>
        <PageTitle sub="Neither of you sees the other's posts, comments or stories.">Blocked people</PageTitle>
        {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRows count={3} badge={false} /> : null}
        {q.data && people.length === 0 ? <Empty icon="ban-outline" title="You haven't blocked anyone" sub="Block somebody from their page, or from the menu on one of their posts." /> : null}
        {people.length ? (
          <Card pad={false}>
            {people.map((row, i) => (
              <View key={row.person.username} style={[styles.row, { borderBottomColor: t.line, borderBottomWidth: i === people.length - 1 ? 0 : StyleSheet.hairlineWidth }]} testID={`blocked-${row.person.username}`}>
                <Avatar person={row.person} size={40} live={false} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.text, fontWeight: "600", fontSize: 16 }} numberOfLines={1}>{row.person.username}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>Blocked {row.since}</Text>
                </View>
                <Button title="Unblock" size="sm" kind="plain" onPress={() => unblock(row.person.username)} busy={busy === row.person.username} testID={`unblock-${row.person.username}`} />
              </View>
            ))}
          </Card>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
});
