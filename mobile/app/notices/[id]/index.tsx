/** One notice with its whole thread, and a box to answer it. */
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { board, useBoardChanged, useNotice, type Comment } from "@/api";
import { ErrorBanner, IconButton, Loading, Screen } from "@/ui";
import { confirm, notify } from "@/ui/confirm";
import { NoticeCard } from "@/ui/NoticeCard";
import { goBack } from "@/nav/paths";
import { sp, useTheme } from "@/ui/theme";

export default function NoticeScreen() {
  const t = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const noticeId = Number(id);
  const q = useNotice(noticeId);
  const changed = useBoardChanged();
  const [reply, setReply] = useState<Comment | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<TextInput>(null);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await board.comment(noticeId, body, reply?.id);
      setBody("");
      setReply(null);
      changed(noticeId);
    } catch (e: any) {
      notify("Couldn't post", e?.message || "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirm("Remove this notice?", "It goes for everyone.", "Remove", async () => { await board.remove(noticeId); changed(); goBack(); });

  React.useEffect(() => {
    if (q.data?.mine) {
      navigation.setOptions({
        headerRight: () => (
          <View style={{ flexDirection: "row" }}>
            <IconButton icon="create-outline" label="Edit" onPress={() => router.push({ pathname: "/notices/compose", params: { id: String(noticeId), body: q.data!.body } })} />
            <IconButton icon="trash-outline" label="Remove" onPress={remove} color={t.danger} />
          </View>
        ),
      });
    }
  }, [q.data?.mine, q.data?.body]);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView contentContainerStyle={{ padding: sp[4] }} keyboardShouldPersistTaps="handled">
          {q.error ? <ErrorBanner message={(q.error as Error).message} onRetry={q.refetch} /> : null}
          {q.isLoading ? <Loading /> : null}
          {q.data ? <NoticeCard notice={q.data} full onComment={(parent) => { setReply(parent || null); box.current?.focus(); }} /> : null}
        </ScrollView>
        <View style={[styles.box, { backgroundColor: t.surface, borderTopColor: t.line }]}>
          {reply ? (
            <View style={styles.replying}>
              <Text style={{ color: t.muted, fontSize: 12 }}>Replying to {reply.author.name}</Text>
              <Pressable onPress={() => setReply(null)} hitSlop={8}><Ionicons name="close" size={16} color={t.muted} /></Pressable>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: sp[2] }}>
            <TextInput
              ref={box}
              value={body}
              onChangeText={setBody}
              placeholder={reply ? "Write a reply…" : "Write a comment…"}
              placeholderTextColor={t.muted}
              multiline
              maxLength={300}
              style={[styles.input, { backgroundColor: t.surface2, color: t.text }]}
              testID="comment-body"
            />
            <Pressable onPress={send} disabled={busy || !body.trim()} style={[styles.send, { backgroundColor: body.trim() ? t.brand : t.surface3 }]} accessibilityLabel="Send">
              <Ionicons name="arrow-up" size={20} color={body.trim() ? t.brandInk : t.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { padding: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
  replying: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6, paddingBottom: 6 },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
});
