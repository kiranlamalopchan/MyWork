/**
 * Friends (templates/accounts/profile.html's #friends section): who your
 * "Friends only" posts and comments reach, right on the profile rather than
 * behind a screen of its own — search, requests and your list, all part of
 * the one page that already answers everything else about you.
 *
 * Only the requests waiting on you are always open, being the one thing
 * here that asks for an answer; the other lists fold behind their counts
 * (SubFold), so a long list of everyone is not the price of opening it.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { friends as api, useFriends, useFriendsChanged, type FriendRequest, type Person } from "@/api";
import { AdminBadge } from "./AdminBadge";
import { Avatar } from "./Avatar";
import { Disclosure } from "./Disclosure";
import { Button, Empty, ErrorBanner, Input, SectionLabel } from "./index";
import { SkeletonFriends } from "./Skeleton";
import type { PanelProps } from "./ProfilePanels";
import { notify } from "./confirm";
import { success, tick } from "./haptics";
import { radius, sp, useTheme } from "./theme";

export function FriendsPanel({ open, onToggle, last }: PanelProps) {
  const t = useTheme();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);
  const query = useFriends(q);
  const changed = useFriendsChanged();
  const data = query.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [shown, setShown] = useState({ sent: false, friends: false, others: false });
  const flip = (k: keyof typeof shown) => setShown((v) => ({ ...v, [k]: !v[k] }));

  const guard = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await run();
      success();
      changed();
    } catch (e: any) {
      notify("That didn't work", e?.message || "");
    } finally {
      setBusy(null);
    }
  };

  const accept = (r: FriendRequest) => guard(`accept-${r.id}`, () => api.accept(r.id));
  const decline = (r: FriendRequest) => guard(`decline-${r.id}`, () => api.decline(r.id));
  const request = (p: Person) => guard(`request-${p.username}`, () => api.request(p.username));
  const remove = (p: Person) => guard(`remove-${p.username}`, () => api.remove(p.username));

  const waiting = data?.received.length || 0;
  const hint = !data
    ? "Who your Friends only posts reach"
    : waiting
      ? `${waiting} request${waiting === 1 ? "" : "s"} waiting on you`
      : `${data.friends.length} friend${data.friends.length === 1 ? "" : "s"}`;

  return (
    <Disclosure icon="people-outline" title="Friends" hint={hint} open={open} onToggle={onToggle} last={last} testID="friends-panel">
      <Text style={{ color: t.muted, fontSize: 13.5, lineHeight: 19 }}>
        Posts and comments marked "Friends only" are shown to the people here.
      </Text>
      {query.error ? <ErrorBanner error={query.error} onRetry={query.refetch} /> : null}
      {query.isLoading ? <SkeletonFriends /> : null}

      {data?.received.length ? (
        <View style={{ gap: sp[2] }}>
          <SectionLabel>Waiting on you</SectionLabel>
          <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            {data.received.map((r, i) => (
              <Row key={r.id} person={r.person} last={i === data.received.length - 1}
                right={(
                  <View style={{ flexDirection: "row", gap: sp[2] }}>
                    <Button title="Accept" size="sm" busy={busy === `accept-${r.id}`} onPress={() => accept(r)} />
                    <Button title="Decline" kind="plain" size="sm" busy={busy === `decline-${r.id}`} onPress={() => decline(r)} />
                  </View>
                )}
              />
            ))}
          </View>
        </View>
      ) : null}

      {data?.sent.length ? (
        <SubFold title="Waiting on them" count={data.sent.length} open={shown.sent} onToggle={() => flip("sent")} testID="friends-sent">
          <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            {data.sent.map((r, i) => (
              <Row key={r.id} person={r.person} sub="Request sent" last={i === data.sent.length - 1}
                right={<Button title="Cancel" kind="plain" size="sm" busy={busy === `decline-${r.id}`} onPress={() => decline(r)} />}
              />
            ))}
          </View>
        </SubFold>
      ) : null}

      {data ? (
        <SubFold title="Your friends" count={data.friends.length} open={shown.friends} onToggle={() => flip("friends")} testID="friends-list">
          {data.friends.length ? (
            <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
              {data.friends.map((p, i) => (
                <Row key={p.username} person={p} last={i === data.friends.length - 1}
                  onPress={() => router.push(`/people/${p.username}`)}
                  right={(
                    <Pressable onPress={() => remove(p)} hitSlop={8} accessibilityLabel={`Remove ${p.name}`}>
                      <Ionicons name="close-circle-outline" size={22} color={t.muted} />
                    </Pressable>
                  )}
                />
              ))}
            </View>
          ) : (
            <Empty icon="people-outline" title="No friends yet" sub="Add people from Everyone else — once you're friends, Friends only posts reach them." card={false} />
          )}
        </SubFold>
      ) : null}

      <SubFold title="Everyone else" count={q ? undefined : data?.others.length} open={shown.others} onToggle={() => flip("others")} testID="friends-others">
        <Input placeholder="Search by username" value={typed} onChangeText={setTyped} autoCapitalize="none" testID="friends-search" />
        {data && data.others.length ? (
          <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            {data.others.map((p, i) => (
              <Row key={p.username} person={p} last={i === data.others.length - 1}
                onPress={() => router.push(`/people/${p.username}`)}
                right={<Button title="Add" size="sm" icon="person-add-outline" busy={busy === `request-${p.username}`} onPress={() => request(p)} />}
              />
            ))}
          </View>
        ) : data ? (
          <Empty icon="search-outline" title={q ? `No one matches "${q}"` : "That's everyone"} card={false} />
        ) : null}
      </SubFold>
    </Disclosure>
  );
}

/**
 * One list inside the panel, folded behind its label and a count. The
 * panel's own fold measures what it holds, so opening one of these grows
 * the panel with it.
 */
function SubFold({ title, count, open, onToggle, children, testID }: {
  title: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode; testID?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: sp[2] }} testID={testID}>
      <Pressable
        onPress={() => { tick(); onToggle(); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={count === undefined ? title : `${title}, ${count}`}
        hitSlop={4}
        style={({ pressed }) => [styles.foldHead, { opacity: pressed ? 0.6 : 1 }]}
      >
        <SectionLabel>{title}</SectionLabel>
        {count !== undefined ? (
          <View style={[styles.count, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            <Text style={{ color: t.text2, fontSize: 12, fontWeight: "600" }}>{count}</Text>
          </View>
        ) : null}
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={t.muted} style={{ marginLeft: "auto" }} />
      </Pressable>
      {open ? children : null}
    </View>
  );
}

function Row({ person, sub, right, last, onPress }: { person: Person; sub?: string; right?: React.ReactNode; last?: boolean; onPress?: () => void }) {
  const t = useTheme();
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={[styles.row, { borderBottomColor: t.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      <Avatar person={person} size={38} live={false} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{person.name}</Text>
          <AdminBadge person={person} size={10} />
        </View>
        <Text style={{ color: t.muted, fontSize: 12.5 }} numberOfLines={1}>{sub || `@${person.username}`}</Text>
      </View>
      {right}
    </Wrap>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.md, overflow: "hidden" },
  foldHead: { flexDirection: "row", alignItems: "center", gap: sp[2], minHeight: 36 },
  count: { minWidth: 22, height: 20, paddingHorizontal: 7, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[3], paddingVertical: sp[3] },
});
