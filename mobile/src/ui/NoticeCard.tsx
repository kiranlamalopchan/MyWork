/**
 * One notice, laid out the way the social apps lay out a post: the author
 * line across the top (face, name, when, and the ⋯ for your own), the
 * words full width beneath, a quiet line of who reacted and how many
 * comments, a rule, then the two icons — like and comment — and the thread
 * with its reply box. The sender's colour is on their face and name only;
 * the card itself stays clean, and your own are marked with a small "You".
 * Everything acts in place — a face, a comment, an edit — the way the site
 * does, and a box that takes focus is scrolled clear of the keyboard.
 */
import React, { useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { board, useBoardChanged, type Comment, type Notice, type ReactionTally, type Visibility } from "@/api";
import { useSession } from "@/auth/session";

import { Avatar } from "./Avatar";
import { confirm } from "./confirm";
import { Card, reactionInk, Tally } from "./index";
import { useReveal } from "./keyboard";
import { ReactionSheet, type Anchor } from "./ReactionPicker";
import { hsl, radius, sp, useTheme } from "./theme";
import { success, tap, tick } from "./haptics";
import { VisibilityBadge, VisibilityToggle } from "./VisibilityPicker";

const menuShadow = (dark: boolean) => (Platform.OS === "android" ? { elevation: 8 } : { shadowColor: "#0f1420", shadowOpacity: dark ? 0.5 : 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } });

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
  // Where the ⋯ menu drops from, measured on the screen when it opens.
  // Where the menu sits stays put after it closes: the modal fades out over
  // it, and with nowhere to be it would fade out in the top-left corner.
  const [menuAt, setMenuAt] = useState<{ top: number; right: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<View>(null);
  const { width } = useWindowDimensions();
  const [draft, setDraft] = useState(given.body);
  const [draftVis, setDraftVis] = useState<Visibility>(given.visibility);
  const [say, setSay] = useState("");
  const [sayVis, setSayVis] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [unfolded, setUnfolded] = useState<Notice | null>(null);
  const editorRef = useRef<View>(null);
  const replyRef = useRef<View>(null);
  const sayRef = useRef<TextInput>(null);
  const notice = unfolded || given;
  const shown = tally || notice;
  const mine = notice.mine;
  const hue = notice.author.hue;
  const inkFor = `hsl(${hue}, 48%, ${t.dark ? 70 : 32}%)`;
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
  const send = async () => {
    const body = say.trim();
    if (!body) return;
    setBusy(true);
    try { setUnfolded(await board.comment(notice.id, body, undefined, sayVis)); success(); setSay(""); setSayVis("public"); changed(notice.id); } finally { setBusy(false); }
  };
  const unfold = async () => setUnfolded(await board.one(notice.id));
  const openMenu = () => {
    tick();
    moreRef.current?.measureInWindow((x, y, w, h) => { setMenuAt({ top: y + h + 4, right: Math.max(sp[3], width - (x + w)) }); setMenuOpen(true); });
  };
  const closeMenu = () => setMenuOpen(false);
  const open = full ? undefined : () => router.push(`/notices/${notice.id}`);
  // The speech bubble: to the thread from the board; on the thread, straight into the box.
  const comment = full ? () => sayRef.current?.focus() : open;

  return (
    <Card pad={false} testID={`notice-${notice.id}`} style={styles.notice}>
      {/* The author line: face, name and when, and the ⋯ (yours) or the new dot (theirs). */}
      <View style={styles.head}>
        <Pressable onPress={() => router.push(`/people/${notice.author.username}`)} style={styles.author}>
          <Avatar person={notice.author} size={42} ring={mine ? t.brandSoft : `hsla(${hue}, 72%, 52%, 0.22)`} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.nameRow}>
              <Text style={[styles.who, { color: mine ? t.text : inkFor }]} numberOfLines={1}>{notice.author.username}</Text>
              {mine ? <Text style={[styles.you, { backgroundColor: t.brandSoft, color: t.brand }]}>You</Text> : null}
            </View>
            <View style={styles.whenRow}>
              <Text style={[styles.when, { color: t.muted }]} numberOfLines={1}>{notice.ago}{notice.edited ? " · edited" : ""}</Text>
              <VisibilityBadge visibility={notice.visibility} />
            </View>
          </View>
        </Pressable>
        {mine && !editing ? (
          <View style={styles.menuWrap}>
            <Pressable ref={moreRef} onPress={openMenu} hitSlop={6} accessibilityLabel="More" testID={`notice-menu-${notice.id}`} style={({ pressed }) => [styles.more, { backgroundColor: pressed || menuOpen ? t.surface2 : "transparent" }]}>
              <Ionicons name="ellipsis-horizontal" size={20} color={t.text2} />
            </Pressable>
            {/* The menu floats over the whole screen so a tap anywhere else closes it. */}
            <Modal transparent visible={menuOpen} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={closeMenu}>
              <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} accessibilityLabel="Close menu" />
              <View style={[styles.menu, menuAt, { backgroundColor: t.surface, borderColor: t.dark ? t.lineStrong : "transparent" }, menuShadow(t.dark)]}>
                <Pressable onPress={() => { closeMenu(); setEditing(true); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: t.surface2 }]} testID={`notice-edit-${notice.id}`}>
                  <Ionicons name="pencil-outline" size={18} color={t.text} />
                  <Text style={{ color: t.text, fontWeight: "600", fontSize: 15 }}>Edit</Text>
                </Pressable>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />
                <Pressable onPress={() => { closeMenu(); remove(); }} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: t.surface2 }]} testID={`notice-remove-${notice.id}`}>
                  <Ionicons name="trash-outline" size={18} color={t.danger} />
                  <Text style={{ color: t.danger, fontWeight: "600", fontSize: 15 }}>Remove</Text>
                </Pressable>
              </View>
            </Modal>
          </View>
        ) : notice.is_new && !mine ? (
          <View style={[styles.dotRing, { backgroundColor: `hsla(${hue}, 72%, 52%, 0.16)` }]}>
            <View style={[styles.dot, { backgroundColor: hsl(hue, 72, 52) }]} />
          </View>
        ) : null}
      </View>

      {/* The words, the full width of the card. */}
      {editing ? (
        <View ref={editorRef} style={{ gap: sp[3] }}>
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
        <Pressable onPress={open} disabled={!open}>
          <Text style={[styles.text, { color: t.text }]}>{notice.body}</Text>
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

      {/* Two plain icons with their counts, no buttons: the thumb (your own
          face, once you have left one) and the speech bubble. A tap on the
          thumb likes; a long press floats the row of faces above it, and a
          tap anywhere else puts the row away. */}
      <View style={styles.acts}>
        <ReactionSheet anchor={faces} mine={shown.my_emoji} onPick={react} onClose={() => setFaces(null)} />
        <View ref={reactRef} collapsable={false}>
          <Act
            onPress={() => react(shown.my_emoji || "👍")}
            onLongPress={openFaces}
            colour={shown.my_emoji ? reactionInk(shown.my_emoji, t) : t.text2}
            label={shown.my_emoji ? labelFor(shown.my_emoji) : "React"}
            emoji={shown.my_emoji || undefined}
            icon="thumbs-up-outline"
            count={shown.total_reactions}
          />
        </View>
        <Act onPress={comment} colour={t.text2} label="Comment" icon="chatbubble-outline" count={comments} />
      </View>

      {notice.older_comments || notice.comments.length || me ? (
        <View style={styles.thread}>
          {notice.older_comments && !unfolded ? (
            <Pressable onPress={unfold} style={styles.fold}>
              <Text style={{ color: t.brand, fontWeight: "600", fontSize: 13.5 }}>View {notice.older_comments} previous comment{notice.older_comments === 1 ? "" : "s"}</Text>
            </Pressable>
          ) : null}
          {notice.comments.map((c) => (
            <CommentRow key={c.id} comment={c} noticeId={notice.id} onChanged={(n) => setUnfolded(n)} />
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
                style={[styles.replyInput, { backgroundColor: t.dark ? t.surface3 : t.surface2, color: t.text }]}
              />
              <VisibilityToggle value={sayVis} onChange={setSayVis} />
              <Pressable onPress={send} disabled={busy || !say.trim()} accessibilityLabel="Send comment" style={[styles.send, { backgroundColor: say.trim() ? t.brand : t.brandSoft }]}>
                <Ionicons name="arrow-up" size={18} color={say.trim() ? t.brandInk : t.brand} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * An icon-only button; its name is for the screen reader (and the drives).
 * React works the way the social apps do: a tap is a like (or takes your
 * own face back), a long press opens the whole row.
 */
function Act({ onPress, onLongPress, colour, label, icon, emoji, count }: { onPress?: () => void; onLongPress?: () => void; colour: string; label: string; icon: keyof typeof Ionicons.glyphMap; emoji?: string; count?: number }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tick(); onPress?.(); }} onLongPress={onLongPress} delayLongPress={350} accessibilityLabel={count ? `${label}, ${count}` : label} accessibilityRole="button" accessibilityHint={onLongPress ? "Hold for all the faces" : undefined} hitSlop={6} style={({ pressed }) => [styles.act, pressed && { transform: [{ scale: 0.9 }], opacity: 0.7 }]}>
      {emoji ? <Text style={{ fontSize: 22, lineHeight: 26 }}>{emoji}</Text> : <Ionicons name={icon} size={23} color={colour} />}
      {count ? <Text style={[styles.count, { color: t.text2 }]}>{count}</Text> : null}
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
export function CommentRow({ comment, noticeId, onChanged, reply = false }: { comment: Comment; noticeId: number; onChanged: (notice: Notice) => void; reply?: boolean }) {
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
          <View style={[styles.bubble, { backgroundColor: t.dark ? t.surface3 : t.surface2 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Text style={[styles.commentWho, { color: t.text }]} numberOfLines={1}>{comment.mine ? "You" : comment.author.username}</Text>
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
            <Pressable onPress={() => { tick(); react(shown.my_emoji || "👍"); }} onLongPress={openFaces} delayLongPress={350} hitSlop={6} accessibilityLabel={shown.my_emoji ? labelFor(shown.my_emoji) : "React"} accessibilityHint="Hold for all the faces">
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
          ) : null}
        </View>
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
            {comment.replies.map((r) => <CommentRow key={r.id} comment={r} noticeId={noticeId} onChanged={onChanged} reply />)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { borderRadius: radius.xl, paddingHorizontal: sp[4], paddingVertical: sp[4], gap: sp[3] },
  head: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  author: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: sp[3] },
  nameRow: { flexDirection: "row", alignItems: "center", gap: sp[2] },
  who: { fontSize: 15.5, fontWeight: "700", letterSpacing: -0.2, flexShrink: 1 },
  you: { fontSize: 11.5, fontWeight: "800", paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, overflow: "hidden" },
  whenRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
  when: { fontSize: 12.5 },
  dotRing: { width: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", marginRight: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  text: { fontSize: 16, lineHeight: 24, letterSpacing: -0.1 },
  editor: { minHeight: 90, padding: 12, borderRadius: radius.md, fontSize: 16, lineHeight: 22, textAlignVertical: "top" },
  metaText: { fontSize: 13.5 },
  rule: { height: StyleSheet.hairlineWidth },
  acts: { flexDirection: "row", alignItems: "center", gap: sp[8], paddingLeft: 2 },
  act: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 32 },
  count: { fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  menuWrap: { alignItems: "flex-end", marginRight: -6 },
  more: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  menu: { position: "absolute", minWidth: 160, borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
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
