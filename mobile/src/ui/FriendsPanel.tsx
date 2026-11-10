/**
 * Friends (templates/accounts/profile.html's #friends section): who your
 * "Friends only" posts and comments reach, on a page opened from Profile.
 *
 * Only the requests waiting on you are always open, being the one thing
 * here that asks for an answer; the other lists fold behind their counts
 * (SubFold), so a long list of everyone is not the price of opening it.
 * Both long lists come a screenful at a time; scrolling near the bottom of
 * the open one brings the next screenful (useMorePeople).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { friends as api, useFriends, useFriendsChanged, type FriendRequest, type Person } from "@/api";
import { AdminBadge } from "./AdminBadge";
import { Avatar } from "./Avatar";
import { useComeUp } from "./depth";
import { Fold, FoldChevron } from "./Disclosure";
import { Button, Card, Empty, ErrorBanner, Input, Page, PageTitle, Screen, usePullRefresh } from "./index";
import { SkeletonFriends } from "./Skeleton";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { confirm, notify } from "./confirm";
import { success, tick } from "./haptics";
import { radius, sp, useTheme } from "./theme";

export function FriendsPage() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);
  const size = useScreenful();
  const query = useFriends(q, size);
  const refresh = usePullRefresh(query.refetch);
  const changed = useFriendsChanged();
  const data = query.data;
  const [busy, setBusy] = useState<string | null>(null);
  // One list open at a time, like the timesheet's days: opening one folds the last away.
  const [list, setList] = useState<"sent" | "friends" | "others" | null>("friends");
  const shown = { sent: list === "sent", friends: list === "friends", others: list === "others" };
  const flip = (k: NonNullable<typeof list>) => setList((v) => (v === k ? null : k));
  const stamp = query.dataUpdatedAt;
  const friendRows = useMorePeople("friends", q, data?.friends, data?.friends_total ?? data?.friends.length, size, stamp);
  const otherRows = useMorePeople("others", q, data?.others, data?.others_total, size, stamp);
  // Near the bottom of the page, the open list brings its next screenful.
  const onScroll = ({ nativeEvent: e }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (e.contentOffset.y + e.layoutMeasurement.height < e.contentSize.height - e.layoutMeasurement.height * 0.6) return;
    if (list === "friends") friendRows.loadMore();
    else if (list === "others") otherRows.loadMore();
  };

  const guard = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await run();
      success();
      changed();
    } catch (e: any) {
      notify(tr("That didn't work"), errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const accept = (r: FriendRequest) => guard(`accept-${r.id}`, () => api.accept(r.id));
  const decline = (r: FriendRequest) => guard(`decline-${r.id}`, () => api.decline(r.id));
  const request = (p: Person) => guard(`request-${p.username}`, () => api.request(p.username));
  const remove = (p: Person) => {
    if (busy) return;
    confirm(`Unfriend ${p.name}?`, `This removes ${p.name} from your friends. You can send them a new friend request later.`, "Unfriend",
      () => { void guard(`remove-${p.username}`, () => api.remove(p.username)); });
  };

  return (
    <Screen back backLabel={tr("Profile")} section={tr("Friends")}>
    <Page refreshControl={refresh} onScroll={onScroll}>
    <PageTitle sub={tr("Manage your friends and requests.")}>{tr("Friends")}</PageTitle>
    <Card style={{ gap: sp[4] }} testID="friends-page">
      <Text style={{ color: t.text2, fontSize: 14, lineHeight: 21 }}>
        Posts and comments marked "Friends only" are shown to the people here.
      </Text>
      {query.error ? <ErrorBanner error={query.error} onRetry={query.refetch} /> : null}
      {query.isLoading ? <SkeletonFriends /> : null}

      {data?.received.length ? (
        <View style={{ gap: sp[2] }}>
          <Text style={{ color: t.text, fontSize: 14.5, fontWeight: "600" }}>Waiting on you</Text>
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
        <SubFold title="Your friends" count={friendRows.total} open={shown.friends} onToggle={() => flip("friends")} testID="friends-list">
          {friendRows.people.length ? (
            <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
              {friendRows.people.map((p, i) => (
                <Row key={p.username} person={p} last={i === friendRows.people.length - 1}
                  onPress={() => router.push(`/people/${p.username}`)}
                  right={(
                    <Pressable onPress={() => remove(p)} disabled={!!busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
                      <Ionicons name="close-circle-outline" size={22} color={t.muted} />
                    </Pressable>
                  )}
                />
              ))}
            </View>
          ) : (
            <Empty icon="people-outline" title={q ? `No friends match "${q}"` : "No friends yet"} sub={q ? undefined : "Add people from Everyone else — once you're friends, Friends only posts reach them."} card={false} />
          )}
          <MoreFooter rows={friendRows} testID="friends-more" />
        </SubFold>
      ) : null}

      <SubFold title="Everyone else" count={q ? undefined : data?.others_total} open={shown.others} onToggle={() => flip("others")} testID="friends-others">
        <Input placeholder="Search by username" value={typed} onChangeText={setTyped} autoCapitalize="none" testID="friends-search" />
        {otherRows.people.length ? (
          <View style={[styles.list, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            {otherRows.people.map((p, i) => (
              <Row key={p.username} person={p} last={i === otherRows.people.length - 1}
                onPress={() => router.push(`/people/${p.username}`)}
                right={<Button title="Add" size="sm" icon="person-add-outline" busy={busy === `request-${p.username}`} onPress={() => request(p)} />}
              />
            ))}
          </View>
        ) : null}
        <MoreFooter rows={otherRows} testID="friends-others-more" />
        {data && !otherRows.people.length ? (
          <Empty icon="search-outline" title={q ? `No one matches "${q}"` : "That's everyone"} card={false} />
        ) : null}
      </SubFold>
    </Card>
    </Page>
    </Screen>
  );
}

/** Rows to a screenful on this phone, so the first load fills the screen and no more. */
function useScreenful() {
  const { height } = useWindowDimensions();
  return Math.max(8, Math.min(30, Math.ceil(height / 60)));
}

type MoreRows = {
  people: Person[]; total?: number; loading: boolean; error: unknown;
  hasMore: boolean; loadMore: () => void; retry: () => void;
};

/**
 * One Friends list as you scroll it: the first screenful from the page's own
 * query, then each next screenful from friends/page/. When the first page is
 * fetched again (pull to refresh, someone added or removed) the rows already
 * scrolled to are fetched again too, so the list doesn't jump back to the top;
 * a new search starts from its first screenful.
 */
function useMorePeople(which: "friends" | "others", q: string, first: Person[] | undefined, total: number | undefined, size: number, stamp: number): MoreRows {
  const [extra, setExtra] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const extraCount = useRef(0);
  extraCount.current = extra.length;
  const lastQ = useRef(q);
  const run = useRef(0);

  const fetchRows = useCallback((offset: number, limit: number, replace: boolean) => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    api.page(which, offset, limit, q || undefined)
      .then((page) => {
        if (id !== run.current) return;
        setExtra((rows) => {
          const next = replace ? page.people : [...rows, ...page.people];
          const seen = new Set<string>();
          return next.filter((p) => !seen.has(p.username) && !!seen.add(p.username));
        });
      })
      .catch((e) => { if (id === run.current) setError(e); })
      .finally(() => { if (id === run.current) setLoading(false); });
  }, [which, q]);

  useEffect(() => {
    const searched = lastQ.current !== q;
    lastQ.current = q;
    const keep = searched ? 0 : extraCount.current;
    if (!first || !keep) {
      run.current++;
      setExtra([]); setLoading(false); setError(null);
      return;
    }
    fetchRows(first.length, Math.min(keep, 50), true);
    // A fresh first page (its stamp) or a new search; the rest follows from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, q]);

  const people = first ? [...first, ...extra.filter((p) => !first.some((f) => f.username === p.username))] : [];
  const hasMore = !!first && total !== undefined && people.length < total;
  const loadMore = () => {
    if (!first || loading || error || !hasMore) return;
    fetchRows(people.length, size, false);
  };
  const retry = () => {
    if (!first || loading) return;
    fetchRows(people.length, size, false);
  };
  return { people, total, loading, error, hasMore, loadMore, retry };
}

/** Under a list: a spinner while the next screenful comes, or a way to try again. */
function MoreFooter({ rows, testID }: { rows: MoreRows; testID?: string }) {
  const t = useTheme(), tr = useT();
  if (rows.error) {
    return (
      <View style={styles.more} testID={testID}>
        <Text style={{ color: t.muted, fontSize: 12.5 }}>{errorMessage(rows.error)}</Text>
        <Button title={tr("Try again")} kind="plain" size="sm" onPress={rows.retry} testID={testID ? `${testID}-retry` : undefined} />
      </View>
    );
  }
  if (rows.loading) {
    return (
      <View style={styles.more} testID={testID} accessibilityLabel={tr("Loading more")}>
        <ActivityIndicator color={t.muted} />
      </View>
    );
  }
  return null;
}

/**
 * One list inside the panel, folded behind its label and a count — with the
 * timesheet's fold (Fold, FoldChevron): it grows open and shrinks shut. The
 * panel's own fold measures what it holds, so opening one of these grows
 * the panel with it.
 */
function SubFold({ title, count, open, onToggle, children, testID }: {
  title: string; count?: number; open: boolean; onToggle: () => void; children: React.ReactNode; testID?: string;
}) {
  const t = useTheme();
  const root = useComeUp(open);
  return (
    <View ref={root} style={{ gap: sp[2] }} testID={testID}>
      <Pressable
        onPress={() => { tick(); onToggle(); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={count === undefined ? title : `${title}, ${count}`}
        hitSlop={4}
        style={({ pressed }) => [styles.foldHead, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={{ color: t.text, fontSize: 14.5, fontWeight: "600" }}>{title}</Text>
        {count !== undefined ? (
          <View style={[styles.count, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            <Text style={{ color: t.text2, fontSize: 12, fontWeight: "600" }}>{count}</Text>
          </View>
        ) : null}
        <View style={{ marginLeft: "auto" }}><FoldChevron open={open} size={16} colour={t.muted} /></View>
      </Pressable>
      <Fold open={open} style={{ gap: sp[2] }}>{children}</Fold>
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
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2], minHeight: 44 },
});
