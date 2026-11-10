/**
 * One conversation. The newest line sits at the foot, above the box you
 * write in; older ones are fetched as the thread is scrolled up. There is
 * no socket — the open thread asks again every few seconds — so a line you
 * send is shown at once and kept or taken back when the server answers.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { chat, useChatChanged, useChatThread, type ChatMessage } from "@/api";
import { errorMessage } from "@/api/errors";
import { useT } from "@/i18n";
import { Avatar, Empty, ErrorBanner, Screen } from "@/ui";
import { WithDepth } from "@/ui/depth";
import { fail, tap } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { radius, sp, useTheme } from "@/ui/theme";

type Line = ChatMessage & { pending?: boolean };

export default function Conversation() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const layout = useLayout();
  const { username } = useLocalSearchParams<{ username: string }>();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); };
  }, []));
  const q = useChatThread(username, focused);
  const changed = useChatChanged();

  // Pages read further back than the newest, and lines sent but not yet answered.
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<unknown>(null);
  const [sending, setSending] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [refused, setRefused] = useState<string | null>(null);
  const nextKey = useRef(-1);

  // Opening a thread reads it: the counts elsewhere are now stale.
  const lastMessage = q.data?.messages.at(-1)?.id;
  useEffect(() => { if (focused && lastMessage) changed(); }, [focused, lastMessage, changed]);

  const lines = useMemo(() => {
    const known = new Map<number, Line>();
    for (const m of older) known.set(m.id, m);
    for (const m of q.data?.messages ?? []) known.set(m.id, m);
    const sorted = [...known.values()].sort((a, b) => a.id - b.id);
    // Newest first: the list is drawn upside down so the foot is the start.
    return [...sorted, ...sending].reverse();
  }, [older, q.data, sending]);

  const hasMore = more ?? q.data?.more ?? false;
  const loadOlder = async () => {
    const oldest = lines.filter((m) => m.id > 0).at(-1);
    if (!hasMore || loadingOlder || !oldest) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await chat.thread(username, oldest.id);
      setOlder((was) => [...page.messages, ...was]);
      setMore(page.more);
    } catch (error) {
      setOlderError(error);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending.length) return;
    tap("light");
    setRefused(null);
    const key = nextKey.current--;
    const now = new Date();
    setSending((was) => [...was, { id: key, body, mine: true, at: now.toISOString(), day: "", time: tr("Sending…"), read: false, pending: true }]);
    try {
      const sent = await chat.send(username, body);
      setText("");
      setOlder((was) => [...was, sent]);
      changed();
    } catch (error) {
      fail();
      setRefused(errorMessage(error));
    } finally {
      setSending((was) => was.filter((m) => m.id !== key));
    }
  };

  const person = q.data?.person;
  const canSend = q.data?.can_send ?? false;
  const title = person ? (
    <Pressable onPress={() => router.push(`/people/${encodeURIComponent(person.username)}` as never)} accessibilityRole="button" accessibilityLabel={tr("{name}'s page", { name: person.name })} style={styles.who}>
      <Avatar person={person} size={34} />
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: "700" }} numberOfLines={1}>{person.name}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }}>{person.is_live ? tr("Here now") : `@${person.username}`}</Text>
      </View>
    </Pressable>
  ) : null;

  return (
    <Screen back backLabel={tr("Messages")}>
      <WithDepth>{(under) => (
        <View style={{ flex: 1 }}>
          <FlatList
            inverted
            data={lines}
            keyExtractor={(m) => String(m.id)}
            {...under.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            // Upside down: the "footer" is the top of the thread, under the bar.
            contentContainerStyle={[layout.column, { paddingTop: sp[3], paddingBottom: under.padTop + sp[3], flexGrow: 1 }]}
            ListFooterComponent={
              <View style={{ gap: sp[3], paddingBottom: sp[3] }}>
                {title}
                {q.error && !q.data ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
                {loadingOlder ? <ActivityIndicator color={t.brand} accessibilityLabel={tr("Loading earlier messages")} /> : null}
                {olderError ? <ErrorBanner error={olderError} onRetry={loadOlder} /> : null}
              </View>
            }
            ListEmptyComponent={q.isLoading ? <ActivityIndicator color={t.brand} style={{ marginTop: sp[6] }} /> : q.data ? (
              // Drawn upside down with the list; turned back the right way up.
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <Empty icon="chatbubbles-outline" title={tr("Say hello")} sub={tr("Messages here are between the two of you.")} card={false} />
              </View>
            ) : undefined}
            renderItem={({ item, index }) => {
              const above = lines[index + 1];
              const newDay = item.day && (!above || above.day !== item.day);
              return (
                <View>
                  {newDay ? <Text style={[styles.day, { color: t.muted }]}>{item.day}</Text> : null}
                  <View style={[styles.bubble, item.mine
                    ? { alignSelf: "flex-end", backgroundColor: t.brand, borderBottomRightRadius: 6, opacity: item.pending ? 0.6 : 1 }
                    : { alignSelf: "flex-start", backgroundColor: t.surface, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 6 }]}>
                    <Text selectable style={{ color: item.mine ? t.brandInk : t.text, fontSize: 16, lineHeight: 22 }}>{item.body}</Text>
                  </View>
                  <Text style={[styles.time, { color: t.muted, alignSelf: item.mine ? "flex-end" : "flex-start" }]}>{item.time}</Text>
                </View>
              );
            }}
          />

          <View style={[layout.column, styles.composer, { borderTopColor: t.line, backgroundColor: t.bg, paddingBottom: Math.max(layout.insets.bottom, sp[2]) }]}>
            {refused ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 13, paddingHorizontal: sp[2] }}>{refused}</Text> : null}
            {q.data && !canSend ? (
              <Text style={{ color: t.muted, fontSize: 14, textAlign: "center", paddingVertical: sp[3] }}>{tr("You can only message your friends.")}</Text>
            ) : (
              <View style={styles.inputRow}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={tr("Message")}
                  placeholderTextColor={t.muted}
                  multiline
                  maxLength={q.data?.max_length ?? 2000}
                  editable={!!q.data && !sending.length}
                  accessibilityLabel={tr("Message")}
                  testID="chat-input"
                  style={[styles.input, { backgroundColor: t.dark ? t.surface2 : t.surface, color: t.text, borderColor: t.line }]}
                />
                <Pressable onPress={() => { void send(); }} disabled={!text.trim() || !q.data || !!sending.length} accessibilityRole="button" accessibilityLabel={tr("Send")} testID="chat-send"
                  style={({ pressed }) => [styles.send, { backgroundColor: t.brand, opacity: !text.trim() ? 0.4 : pressed ? 0.8 : 1 }]}>
                  <Ionicons name="arrow-up" size={22} color={t.brandInk} />
                </Pressable>
              </View>
            )}
          </View>
        </View>
      )}</WithDepth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: sp[3], alignSelf: "center", minHeight: 44 },
  day: { alignSelf: "center", fontSize: 12, fontWeight: "600", marginTop: sp[4], marginBottom: sp[2] },
  bubble: { maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginTop: 6 },
  time: { fontSize: 11, marginTop: 2, marginHorizontal: 6 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: sp[2], gap: 4 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: sp[2] },
  input: { flex: 1, minHeight: 44, maxHeight: 132, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
