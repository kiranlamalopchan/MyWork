/**
 * One notice as the board shows it: who, when, the words, the tally, and
 * the newest comments folded the way the site folds them. Tapping the body
 * opens the notice; the React button opens the row of faces.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { board, useBoardChanged, type Comment, type Notice, type ReactionTally } from "@/api";

import { Avatar, Body, Card, EmojiRow, Tally } from "./index";
import { sp, useTheme } from "./theme";

export function NoticeCard({ notice, full = false, onComment }: { notice: Notice; full?: boolean; onComment?: (parent?: Comment) => void }) {
  const t = useTheme();
  const router = useRouter();
  const changed = useBoardChanged();
  const [picking, setPicking] = useState(false);
  const [tally, setTally] = useState<ReactionTally | null>(null);
  const shown = tally || notice;

  const react = async (emoji: string) => {
    setPicking(false);
    setTally(await board.react(notice.id, emoji));
    changed(notice.id);
  };

  return (
    <Card pad={false} testID={`notice-${notice.id}`}>
      <Pressable onPress={() => router.push(`/people/${notice.author.username}`)} style={styles.head}>
        <Avatar person={notice.author} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: t.text }]}>{notice.author.name}{notice.mine ? " (you)" : ""}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>{notice.ago}{notice.edited ? " · edited" : ""}</Text>
        </View>
        {notice.is_new ? <View style={[styles.new, { backgroundColor: t.brand }]} /> : null}
      </Pressable>
      <Pressable onPress={full ? undefined : () => router.push(`/notices/${notice.id}`)} style={styles.bodyWrap}>
        <Body>{notice.body}</Body>
      </Pressable>
      <View style={styles.meta}>
        <Tally tally={shown} onPress={() => router.push(`/notices/${notice.id}/reactions`)} />
        <View style={{ flex: 1 }} />
        {notice.comment_total ? (
          <Text style={{ color: t.muted, fontSize: 13 }}>{notice.comment_total} comment{notice.comment_total === 1 ? "" : "s"}</Text>
        ) : null}
      </View>
      <View style={[styles.actions, { borderTopColor: t.line }]}>
        <Pressable onPress={() => setPicking((v) => !v)} style={styles.action}>
          <Text style={{ fontSize: 18 }}>{shown.my_emoji || "👍"}</Text>
          <Text style={[styles.actionText, { color: shown.my_emoji ? t.brand : t.text2 }]}>{shown.my_emoji ? labelFor(shown.my_emoji) : "React"}</Text>
        </Pressable>
        <Pressable onPress={() => (onComment ? onComment() : router.push(`/notices/${notice.id}`))} style={styles.action}>
          <Ionicons name="chatbubble-outline" size={18} color={t.text2} />
          <Text style={[styles.actionText, { color: t.text2 }]}>Comment</Text>
        </Pressable>
      </View>
      {picking ? (
        <View style={[styles.picker, { borderTopColor: t.line }]}>
          <EmojiRow mine={shown.my_emoji} onPick={react} />
        </View>
      ) : null}
      {notice.comments.length || notice.older_comments ? (
        <View style={[styles.thread, { borderTopColor: t.line }]}>
          {notice.older_comments && !full ? (
            <Pressable onPress={() => router.push(`/notices/${notice.id}`)}>
              <Text style={{ color: t.brand, fontWeight: "600", marginBottom: sp[2] }}>See {notice.older_comments} earlier comment{notice.older_comments === 1 ? "" : "s"}</Text>
            </Pressable>
          ) : null}
          {notice.comments.map((c) => (
            <CommentRow key={c.id} comment={c} noticeId={notice.id} full={full} onReply={onComment} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const LABELS: Record<string, string> = { "👍": "Like", "❤️": "Love", "🥰": "Care", "😂": "Haha", "😮": "Wow", "😢": "Sad", "😡": "Angry" };
const labelFor = (emoji: string) => LABELS[emoji] || "Reacted";

export function CommentRow({ comment, noticeId, full, onReply, reply = false }: { comment: Comment; noticeId: number; full?: boolean; onReply?: (parent?: Comment) => void; reply?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const changed = useBoardChanged();
  const [picking, setPicking] = useState(false);
  const [tally, setTally] = useState<ReactionTally | null>(null);
  const shown = tally || comment;

  const react = async (emoji: string) => {
    setPicking(false);
    setTally(await board.reactComment(comment.id, emoji));
    changed(noticeId);
  };
  const remove = async () => {
    await board.removeComment(comment.id);
    changed(noticeId);
  };

  return (
    <View style={[styles.comment, reply && styles.replyIndent]}>
      <Pressable onPress={() => router.push(`/people/${comment.author.username}`)}>
        <Avatar person={comment.author} size={reply ? 24 : 30} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={[styles.bubble, { backgroundColor: t.surface2 }]}>
          <Text style={[styles.name, { color: t.text, fontSize: 13 }]}>{comment.author.name}</Text>
          <Text style={{ color: t.text, fontSize: 15, lineHeight: 20 }}>{comment.body}</Text>
        </View>
        <View style={styles.commentMeta}>
          <Text style={{ color: t.muted, fontSize: 12 }}>{comment.ago}</Text>
          <Pressable onPress={() => setPicking((v) => !v)} hitSlop={6}>
            <Text style={{ color: shown.my_emoji ? t.brand : t.muted, fontSize: 12, fontWeight: "600" }}>{shown.my_emoji ? `${shown.my_emoji} ${labelFor(shown.my_emoji)}` : "React"}</Text>
          </Pressable>
          {!reply && onReply ? (
            <Pressable onPress={() => onReply(comment)} hitSlop={6}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>Reply</Text>
            </Pressable>
          ) : null}
          {comment.mine ? (
            <Pressable onPress={remove} hitSlop={6}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: "600" }}>Delete</Text>
            </Pressable>
          ) : null}
          {shown.total_reactions ? (
            <Pressable onPress={() => router.push({ pathname: "/notices/[id]/reactions", params: { id: String(noticeId), comment: String(comment.id) } })}>
              <Text style={{ fontSize: 12 }}>{shown.reactions.slice(0, 3).map((r) => r.emoji).join("")} {shown.total_reactions}</Text>
            </Pressable>
          ) : null}
        </View>
        {picking ? <EmojiRow mine={shown.my_emoji} onPick={react} /> : null}
        {comment.older_replies && !full ? (
          <Pressable onPress={() => router.push(`/notices/${noticeId}`)}>
            <Text style={{ color: t.brand, fontSize: 13, fontWeight: "600", marginTop: 4 }}>See {comment.older_replies} earlier repl{comment.older_replies === 1 ? "y" : "ies"}</Text>
          </Pressable>
        ) : null}
        {comment.replies.map((r) => (
          <CommentRow key={r.id} comment={r} noticeId={noticeId} full={full} onReply={onReply} reply />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[4], paddingBottom: sp[2] },
  name: { fontWeight: "700", fontSize: 15 },
  new: { width: 8, height: 8, borderRadius: 4 },
  bodyWrap: { paddingHorizontal: sp[4], paddingBottom: sp[2] },
  meta: { flexDirection: "row", alignItems: "center", paddingHorizontal: sp[4], paddingBottom: sp[2], minHeight: 20 },
  actions: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  actionText: { fontWeight: "700", fontSize: 14 },
  picker: { borderTopWidth: StyleSheet.hairlineWidth, padding: sp[3] },
  thread: { borderTopWidth: StyleSheet.hairlineWidth, padding: sp[3], gap: sp[3] },
  comment: { flexDirection: "row", gap: sp[2], marginTop: 2 },
  replyIndent: { marginTop: sp[2] },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start", maxWidth: "100%" },
  commentMeta: { flexDirection: "row", gap: sp[3], paddingHorizontal: 8, paddingTop: 4, alignItems: "center", flexWrap: "wrap" },
});
