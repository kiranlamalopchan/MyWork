/**
 * The website's full notice as native controls: author-tinted surface,
 * author and message, reaction tally, equal-width actions and the thread.
 * Everything acts in place — a face, a comment, an edit — the way the site
 * does, and a box that takes focus is scrolled clear of the keyboard.
 */
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { board, safety, useBoardChanged, useSafetyChanged, type Comment, type Notice, type ReactionTally, type Visibility } from "@/api";
import { useSession } from "@/auth/session";

import { ActionMenu } from "./ActionMenu";
import { Avatar } from "./Avatar";
import { AdminBadge } from "./AdminBadge";
import { confirm, notify } from "./confirm";
import { reactionInk, Tally } from "./index";
import { NoticeSurface } from "./NoticeSurface";
import { useReveal } from "./keyboard";
import { ReactionSheet, type Anchor } from "./ReactionPicker";
import { ReportSheet, type ReportTarget } from "./ReportSheet";
import { hsl, radius, sp, useTheme } from "./theme";
import { success, tap, tick } from "./haptics";
import { VisibilityBadge, VisibilityToggle } from "./VisibilityPicker";

const LABELS: Record<string, string> = { "👍": "Like", "❤️": "Love", "🥰": "Care", "😂": "Haha", "😮": "Wow", "😢": "Sad", "😡": "Angry" };
const labelFor = (emoji: string) => LABELS[emoji] || "Reacted";

function NoticeCardInner({ notice: given, full = false }: { notice: Notice; full?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const { me } = useSession();
  const changed = useBoardChanged();
  const reveal = useReveal();
  const [faces, setFaces] = useState<Anchor | null>(null);
  const reactRef = useRef<View>(null);
  const [tally, setTally] = useState<ReactionTally | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(given.body);
  const [draftVis, setDraftVis] = useState<Visibility>(given.visibility);
  const [say, setSay] = useState("");
  const [sayVis, setSayVis] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [unfolded, setUnfolded] = useState<Notice | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const safetyChanged = useSafetyChanged();
  const editorRef = useRef<View>(null);
  const replyRef = useRef<View>(null);
  const sayRef = useRef<TextInput>(null);
  const notice = unfolded || given;
  const shown = tally || notice;
  const mine = notice.mine;
  const hue = notice.author.hue;
  const inkFor = t.dark ? hsl(hue, 72, 78) : hsl(hue, 48, 32);
  const comments = notice.comment_total;

  const react = async (emoji: string) => {
    setFaces(null);
    setTally(await board.react(notice.id, emoji));
    changed(notice.id);
  };
  // The whole row of faces, floated just above the thumb.
  const openFaces = () => { tap("heavy"); reactRef.current?.measureInWindow((x, y, width, height) => setFaces({ x, y, width, height })); };
  const save = async () => {
    setBusy(true);
    try { await board.edit(notice.id, draft.trim(), draftVis); success(); setEditing(false); changed(notice.id); } finally { setBusy(false); }
  };
  const remove = () => confirm("Remove this notice?", "Everyone loses sight of it.", "Remove", async () => { await board.remove(notice.id); changed(notice.id); });
  // Admins: hold it at the top of the board, or let it go. Kept here as well
  // as on the notice so the card says so at once, before the board has been
  // asked again and moved it.
  const [pinnedNow, setPinnedNow] = useState<boolean | null>(null);
  const pinned = pinnedNow ?? !!notice.pinned;
  const togglePin = async () => {
    const next = !pinned;
    try {
      await (next ? board.pin(notice.id) : board.unpin(notice.id));
      setPinnedNow(next);
      success();
      changed(notice.id);
    } catch (e: any) {
      notify(next ? "Couldn't pin it" : "Couldn't unpin it", e?.message || "");
    }
  };
  // Somebody else's: flag it, or stop hearing from them altogether.
  const report = () => setReporting({ kind: "notice", id: notice.id, username: notice.author.username, excerpt: notice.body });
  const block = () => confirm(`Block ${notice.author.username}?`, "Neither of you will see the other's posts, comments or stories, and any friendship ends.", "Block", async () => {
    await safety.block(notice.author.username);
    safetyChanged();
  });
  const send = async () => {
    const body = say.trim();
    if (!body) return;
    setBusy(true);
    try { setUnfolded(await board.comment(notice.id, body, undefined, sayVis)); success(); setSay(""); setSayVis("public"); changed(notice.id); } finally { setBusy(false); }
  };
  const unfold = async () => setUnfolded(await board.one(notice.id));
  const open = full ? undefined : () => router.push(`/notices/${notice.id}`);
  const comment = () => { reveal(replyRef.current); sayRef.current?.focus(); };

  return (
    <NoticeSurface notice={{ ...notice, pinned }} style={styles.notice}>
      {/* Held at the top by an admin: said in words, so nobody wonders why
          last week's notice is first. */}
      {pinned ? (
        <View style={styles.pinnedRow} testID={`notice-pinned-${notice.id}`}>
          <Ionicons name="pin" size={13} color={t.brand} />
          <Text style={[styles.pinnedText, { color: t.brand }]}>Pinned</Text>
        </View>
      ) : null}
      {/* The author line: face, name and when, and the ⋯ (yours) or the new dot (theirs). */}
      <View style={styles.head}>
        <Pressable onPress={() => router.push(`/people/${notice.author.username}`)} style={styles.author}>
          <Avatar person={notice.author} size={42} ring={mine ? t.brandSoft : `hsla(${hue}, 72%, 52%, 0.22)`} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.who, { color: mine ? t.text : inkFor }]} numberOfLines={1}>{mine ? "You" : notice.author.username}</Text>
              <AdminBadge person={notice.author} />
            </View>
            <View style={styles.whenRow}>
              <Text style={[styles.when, { color: t.muted }]} numberOfLines={1}>{notice.ago}{notice.edited ? " · edited" : ""}</Text>
              <VisibilityBadge visibility={notice.visibility} />
            </View>
          </View>
        </Pressable>
        {!editing ? (
          <View style={styles.menuWrap}>
            {notice.is_new && !mine ? (
              <View style={[styles.dotRing, { backgroundColor: `hsla(${hue}, 72%, 52%, 0.16)` }]}>
                <View style={[styles.dot, { backgroundColor: hsl(hue, 72, 52) }]} />
              </View>
            ) : null}
            <ActionMenu label="Notice actions" actions={[
              ...(mine ? [
                { label: "Edit", icon: "pencil-outline" as const, onPress: () => setEditing(true) },
                { label: "Delete", icon: "trash-outline" as const, destructive: true, onPress: remove },
              ] : [
                { label: "Report", icon: "flag-outline" as const, onPress: report },
                { label: `Block ${notice.author.username}`, icon: "ban-outline" as const, destructive: true, onPress: block },
              ]),
              ...(notice.can_pin ? [{ label: pinned ? "Unpin" : "Pin", icon: pinned ? "pin-outline" as const : "pin" as const, onPress: togglePin }] : []),
            ]} />
          </View>
        ) : null}
      </View>
      <ReportSheet target={reporting} onClose={() => setReporting(null)} />

      {/* The message aligns with the author's name, as on the website. */}
      {editing ? (
        <View ref={editorRef} style={{ gap: sp[3], marginLeft: 54 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={() => reveal(editorRef.current)}
            multiline
            maxLength={600}
            autoFocus
            testID="notice-editor"
            style={[styles.editor, { backgroundColor: t.dark ? t.surface3 : t.surface2, color: t.text }]}
          />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2] }}>
            <VisibilityToggle value={draftVis} onChange={setDraftVis} />
            <View style={{ flexDirection: "row", gap: sp[2] }}>
              <SmallButton title="Cancel" onPress={() => { setEditing(false); setDraft(notice.body); setDraftVis(notice.visibility); }} />
              <SmallButton title="Save" primary icon="checkmark" onPress={save} disabled={busy || !draft.trim()} />
            </View>
          </View>
        </View>
      ) : (
        <Pressable onPress={open} disabled={!open} style={{ marginLeft: 54 }}>
          <Text style={[styles.text, { color: t.text2 }]}>{notice.body}</Text>
        </Pressable>
      )}

      {/* Who reacted, and how many have spoken: a quiet line, each half a tap from the detail. */}
      {shown.total_reactions || comments ? (
        <Tally
          tally={shown}
          onPress={() => router.push(`/notices/${notice.id}/reactions`)}
          right={comments ? (
            <Pressable onPress={comment} hitSlop={6}>
              <Text style={[styles.metaText, { color: t.muted }]}>{comments} comment{comments === 1 ? "" : "s"}</Text>
            </Pressable>
          ) : null}
        />
      ) : null}

      <View style={[styles.rule, { backgroundColor: t.line }]} />

      {/* The website's action row, with native touch targets and picker. */}
      <View style={styles.acts}>
        <ReactionSheet anchor={faces} mine={shown.my_emoji} onPick={react} onClose={() => setFaces(null)} />
        <View ref={reactRef} collapsable={false} style={{ flex: 1 }}>
          <Act
            onPress={openFaces}
            onLongPress={openFaces}
            colour={shown.my_emoji ? reactionInk(shown.my_emoji, t) : t.text2}
            label={shown.my_emoji ? labelFor(shown.my_emoji) : "React"}
            emoji={shown.my_emoji || undefined}
            icon="happy-outline"
          />
        </View>
        <Act onPress={comment} colour={t.muted} label="Comment" icon="chatbubble-outline" />
        {!mine ? <Act onPress={report} colour={t.muted} label="Report" icon="flag-outline" /> : null}
      </View>

      {notice.older_comments || notice.comments.length || me ? (
        <View style={styles.thread}>
          {notice.older_comments && !unfolded ? (
            <Pressable onPress={unfold} style={styles.fold}>
              <Text style={{ color: t.brand, fontWeight: "600", fontSize: 13.5 }}>View {notice.older_comments} previous comment{notice.older_comments === 1 ? "" : "s"}</Text>
            </Pressable>
          ) : null}
          {notice.comments.map((c) => (
            <CommentRow key={c.id} comment={c} noticeId={notice.id} onChanged={(n) => setUnfolded(n)} bubbleBackground={mine ? t.surface2 : t.surface} />
          ))}
          {me ? (
            <View ref={replyRef} style={styles.reply}>
              <Avatar person={me} size={32} live={false} />
              <TextInput
                ref={sayRef}
                value={say}
                onChangeText={setSay}
                onFocus={() => reveal(replyRef.current)}
                placeholder="Write a comment…"
                placeholderTextColor={t.muted}
                maxLength={300}
                returnKeyType="send"
                onSubmitEditing={send}
                blurOnSubmit={false}
                testID={`say-${notice.id}`}
                style={[styles.replyInput, { backgroundColor: mine ? t.surface2 : t.surface, color: t.text }]}
              />
              <VisibilityToggle value={sayVis} onChange={setSayVis} />
              <Pressable onPress={send} disabled={busy || !say.trim()} accessibilityLabel="Send comment" style={[styles.send, { backgroundColor: say.trim() ? t.brand : t.brandSoft }]}>
                <Ionicons name="arrow-up" size={18} color={say.trim() ? t.brandInk : t.brand} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </NoticeSurface>
  );
}

/**
 * Each native action fills an equal share of the row. Quiet labels give
 * way to icons on narrow screens, while accessible names remain available.
 */
function Act({ onPress, onLongPress, colour, label, icon, emoji, showLabel = true, showIcon = true, weight }: { onPress?: () => void; onLongPress?: () => void; colour: string; label: string; icon: keyof typeof Ionicons.glyphMap; emoji?: string; showLabel?: boolean; showIcon?: boolean; weight?: number }) {
  return (
    <Pressable onPress={() => { tick(); onPress?.(); }} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={label} accessibilityRole="button" style={({ pressed }) => [styles.act, { flex: weight ?? (showLabel ? 1 : 0.7) }, pressed && { transform: [{ scale: 0.96 }], opacity: 0.7 }]}>
      {showIcon ? emoji ? <Text style={{ fontSize: 18, lineHeight: 22 }}>{emoji}</Text> : <Ionicons name={icon} size={17} color={colour} /> : null}
      {showLabel ? <Text style={{ color: colour, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{label}</Text> : null}
    </Pressable>
  );
}

function SmallButton({ title, onPress, primary, icon, disabled }: { title: string; onPress: () => void; primary?: boolean; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.small, { backgroundColor: primary ? t.brand : t.surface2, opacity: disabled ? 0.5 : 1 }]}>
      {icon ? <Ionicons name={icon} size={16} color={primary ? t.brandInk : t.text} /> : null}
      <Text style={{ color: primary ? t.brandInk : t.text, fontWeight: "600", fontSize: 14 }}>{title}</Text>
    </Pressable>
  );
}

/**
 * A comment: the face, a bubble with the name over the words, then the
 * small line under it — when, React, Reply, Delete — and any replies
 * indented beneath. React works like the notice's: tap to like, hold for
 * the row.
 */
export function CommentRow({ comment, noticeId, onChanged, reply = false, bubbleBackground }: { comment: Comment; noticeId: number; onChanged: (notice: Notice) => void; reply?: boolean; bubbleBackground?: string }) {
  const t = useTheme();
  const router = useRouter();
  const changed = useBoardChanged();
  const reveal = useReveal();
  const [faces, setFaces] = useState<Anchor | null>(null);
  const reactRef = useRef<View>(null);
  const [replying, setReplying] = useState(false);
  const [say, setSay] = useState("");
  const [sayVis, setSayVis] = useState<Visibility>("public");
  const [tally, setTally] = useState<ReactionTally | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const replyRef = useRef<View>(null);
  const shown = tally || comment;

  const react = async (emoji: string) => {
    setFaces(null);
    setTally(await board.reactComment(comment.id, emoji));
    changed(noticeId);
  };
  const openFaces = () => { tap("heavy"); reactRef.current?.measureInWindow((x, y, width, height) => setFaces({ x, y, width, height })); };
  const remove = () => confirm("Delete this comment?", undefined, "Delete", async () => {
    onChanged(await board.removeComment(comment.id));
    changed(noticeId);
  });
  const send = async () => {
    const body = say.trim();
    if (!body) return;
    onChanged(await board.comment(noticeId, body, comment.parent || comment.id, sayVis));
    success();
    setSay("");
    setSayVis("public");
    setReplying(false);
    changed(noticeId);
  };
  const unfold = async () => { onChanged(await board.one(noticeId)); setUnfolded(true); };

  return (
    <View style={styles.comment}>
      <Pressable onPress={() => router.push(`/people/${comment.author.username}`)}>
        <Avatar person={comment.author} size={reply ? 26 : 32} live={false} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row" }}>
          <View style={[styles.bubble, { backgroundColor: bubbleBackground || t.surface2 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={[styles.commentWho, { color: t.text }]} numberOfLines={1}>{comment.mine ? "You" : comment.author.username}</Text>
              <AdminBadge person={comment.author} size={10} />
              <VisibilityBadge visibility={comment.visibility} size={11} />
            </View>
            <Text style={[styles.commentText, { color: t.text }]}>{comment.body}</Text>
            {shown.total_reactions ? (
              <Pressable
                onPress={() => router.push({ pathname: "/notices/[id]/reactions", params: { id: String(noticeId), comment: String(comment.id) } })}
                style={[styles.commentTally, { backgroundColor: t.surface, borderColor: t.line }]}
              >
                <Text style={{ fontSize: 11 }}>{shown.reactions.slice(0, 3).map((r) => r.emoji).join("")}</Text>
                {shown.total_reactions > 1 ? <Text style={{ color: t.muted, fontSize: 11, fontWeight: "600" }}>{shown.total_reactions}</Text> : null}
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.commentFoot}>
          <Text style={[styles.foot, { color: t.muted }]}>{comment.ago}</Text>
          <View ref={reactRef} collapsable={false}>
            <Pressable onPress={openFaces} onLongPress={openFaces} delayLongPress={350} hitSlop={6} accessibilityLabel={shown.my_emoji ? labelFor(shown.my_emoji) : "React"}>
              <Text style={[styles.footAct, { color: shown.my_emoji ? reactionInk(shown.my_emoji, t) : t.text2 }]}>{shown.my_emoji ? `${shown.my_emoji} ${labelFor(shown.my_emoji)}` : "React"}</Text>
            </Pressable>
          </View>
          <ReactionSheet anchor={faces} mine={shown.my_emoji} onPick={react} onClose={() => setFaces(null)} />
          <Pressable onPress={() => setReplying((v) => !v)} hitSlop={6}>
            <Text style={[styles.footAct, { color: t.text2 }]}>Reply</Text>
          </Pressable>
          {comment.mine ? (
            <Pressable onPress={remove} hitSlop={6}>
              <Text style={[styles.footAct, { color: t.text2 }]}>Delete</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setReporting({ kind: "comment", id: comment.id, username: comment.author.username, excerpt: comment.body })} hitSlop={6} testID={`comment-report-${comment.id}`}>
              <Text style={[styles.footAct, { color: t.text2 }]}>Report</Text>
            </Pressable>
          )}
        </View>
        <ReportSheet target={reporting} onClose={() => setReporting(null)} />
        {replying ? (
          <View ref={replyRef} style={[styles.reply, { marginTop: sp[2] }]}>
            <TextInput
              value={say}
              onChangeText={setSay}
              onFocus={() => reveal(replyRef.current)}
              autoFocus
              placeholder={`Reply to ${comment.mine ? "yourself" : comment.author.username}…`}
              placeholderTextColor={t.muted}
              maxLength={300}
              returnKeyType="send"
              onSubmitEditing={send}
              style={[styles.replyInput, { backgroundColor: t.dark ? t.surface3 : t.surface2, color: t.text, height: 36 }]}
            />
            <VisibilityToggle value={sayVis} onChange={setSayVis} size={30} />
            <Pressable onPress={send} disabled={!say.trim()} accessibilityLabel="Send reply" style={[styles.send, { backgroundColor: say.trim() ? t.brand : t.brandSoft, width: 36, height: 36 }]}>
              <Ionicons name="arrow-up" size={16} color={say.trim() ? t.brandInk : t.brand} />
            </Pressable>
            <Pressable onPress={() => setReplying(false)} hitSlop={6}>
              <Text style={[styles.footAct, { color: t.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {comment.older_replies && !unfolded ? (
          <Pressable onPress={unfold} style={styles.fold}>
            <Text style={{ color: t.brand, fontSize: 12.5, fontWeight: "600" }}>View {comment.older_replies} more repl{comment.older_replies === 1 ? "y" : "ies"}</Text>
          </Pressable>
        ) : null}
        {comment.replies.length ? (
          <View style={styles.replies}>
            {comment.replies.map((r) => <CommentRow key={r.id} comment={r} noticeId={noticeId} onChanged={onChanged} reply bubbleBackground={bubbleBackground} />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { paddingHorizontal: sp[4], paddingVertical: sp[4], gap: sp[2] },
  head: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  pinnedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: -sp[1] },
  pinnedText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
  author: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: sp[3] },
  nameRow: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  who: { fontSize: 15.5, fontWeight: "700", letterSpacing: -0.2, flexShrink: 1 },
  whenRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  when: { fontSize: 12.5 },
  dotRing: { width: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", marginRight: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  text: { fontSize: 14.5, lineHeight: 22 },
  editor: { minHeight: 90, padding: 12, borderRadius: radius.md, fontSize: 16, lineHeight: 22, textAlignVertical: "top" },
  metaText: { fontSize: 13.5 },
  rule: { height: StyleSheet.hairlineWidth },
  acts: { flexDirection: "row", alignItems: "center", gap: 2 },
  act: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 44, minWidth: 40, borderRadius: radius.pill },
  menuWrap: { flexDirection: "row", alignItems: "center", marginRight: -6 },
  thread: { gap: sp[3] },
  fold: { paddingVertical: 2 },
  comment: { flexDirection: "row", alignItems: "flex-start", gap: sp[2] },
  bubble: { paddingHorizontal: sp[3], paddingVertical: sp[2], borderRadius: radius.md, maxWidth: "100%", flexShrink: 1, gap: 1 },
  commentWho: { fontSize: 13, fontWeight: "700" },
  commentText: { fontSize: 14.5, lineHeight: 20 },
  commentTally: { position: "absolute", right: -6, bottom: -10, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, height: 20, borderRadius: 10, borderWidth: 1 },
  commentFoot: { flexDirection: "row", alignItems: "center", gap: sp[3], marginTop: 5, paddingLeft: 6, flexWrap: "wrap" },
  foot: { fontSize: 12 },
  footAct: { fontSize: 12, fontWeight: "700" },
  replies: { marginTop: sp[2], gap: sp[2] },
  reply: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  replyInput: { flex: 1, minWidth: 0, height: 42, paddingHorizontal: sp[4], borderRadius: radius.pill, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  small: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill },
});

/** A card on a list re-renders only when its own notice does, not when the list does. */
export const NoticeCard = React.memo(NoticeCardInner);
