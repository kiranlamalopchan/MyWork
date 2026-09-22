/**
 * The viewer: somebody's stories full-screen, one after another — a bar
 * per story across the top, tap the right to go on and the left to go
 * back, hold to pause, a clip for as long as it runs. The row of faces to
 * react with; for your own, who has looked, and a way to take it down.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { stories as api, useStoriesChanged, useStoryPerson, type Story } from "@/api";
import { unreachable } from "@/api/client";
import { AdminBadge, Avatar, EmojiRow } from "@/ui";
import { SkeletonStory } from "@/ui/Skeleton";
import { confirm } from "@/ui/confirm";
import { ReportSheet, type ReportTarget } from "@/ui/ReportSheet";
import { VisibilityBadge } from "@/ui/VisibilityPicker";
import { goBack } from "@/nav/paths";
import { sp } from "@/ui/theme";

const PHOTO_SECONDS = 5;

export default function Viewer() {
  const { width } = useWindowDimensions();
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const q = useStoryPerson(username);
  const changed = useStoriesChanged();
  const [index, setIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showViewers, setShowViewers] = useState(false);
  // Somebody else's story, being flagged: the timer waits while the sheet is up.
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [tally, setTally] = useState<Record<number, { my_emoji: string; reactions: Story["reactions"] }>>({});
  const started = useRef(0);
  const elapsed = useRef(0);

  const list = q.data?.stories ?? [];
  const story = index !== null ? list[index] : undefined;

  useEffect(() => {
    if (q.data && index === null) setIndex(q.data.start);
  }, [q.data, index]);

  // Seen, the moment it is shown.
  useEffect(() => {
    if (story && !story.mine) api.seen(story.id).catch(() => {});
  }, [story?.id]);

  const close = useCallback(() => {
    changed();
    goBack();
  }, [changed, router]);

  const next = useCallback(() => {
    if (index === null) return;
    if (index + 1 < list.length) setIndex(index + 1);
    else close();
  }, [index, list.length, close]);
  const prev = useCallback(() => {
    if (index === null) return;
    setIndex(Math.max(0, index - 1));
  }, [index]);

  // A photo runs on a clock; a clip on the player's own. The player is
  // made once, empty (nothing is shown yet when it is made), and given
  // each clip as it comes up — the hook only reads its source the first
  // time, so a clip set later has to be put in with `replace`.
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const { currentTime } = useEvent(player, "timeUpdate", { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });
  const { status } = useEvent(player, "statusChange", { status: player.status });

  useEffect(() => {
    try { player.replace(story?.kind === "video" && story.video ? { uri: story.video } : null); } catch {}
  }, [story?.id]);
  // A clip just put in isn't ready at once (on the web a play() before the
  // load is done is thrown away): start it when the player says it can.
  useEffect(() => {
    if (story?.kind === "video" && status === "readyToPlay" && !paused) player.play();
  }, [status, story?.id]);

  useEffect(() => {
    if (!story) return;
    setProgress(0);
    elapsed.current = 0;
    started.current = Date.now();
    if (story.kind === "video") {
      // Started by the effect above, once the clip is ready.
      player.currentTime = 0;
      return;
    }
    if (paused) return;
    const tick = setInterval(() => {
      const p = Math.min((Date.now() - started.current + elapsed.current) / (PHOTO_SECONDS * 1000), 1);
      setProgress(p);
      if (p >= 1) { clearInterval(tick); next(); }
    }, 50);
    return () => clearInterval(tick);
  }, [story?.id, paused]);

  useEffect(() => {
    if (story?.kind !== "video") return;
    const d = story.duration || player.duration || 0;
    if (d > 0) setProgress(Math.min(currentTime / d, 1));
    if (d > 0 && currentTime >= d - 0.15 && !paused) next();
  }, [currentTime, status]);

  // Away in the background, the timer would count the whole absence
  // against the story; it is paused going out and started fresh coming back.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") hold();
      else if (state === "active") release();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id, story?.kind]);

  const hold = () => {
    setPaused(true);
    if (story?.kind === "video") player.pause();
    else elapsed.current += Date.now() - started.current;
  };
  const release = () => {
    setPaused(false);
    started.current = Date.now();
    if (story?.kind === "video") player.play();
  };

  const react = async (emoji: string) => {
    if (!story) return;
    const left = await api.react(story.id, emoji);
    setTally((prev) => ({ ...prev, [story.id]: left }));
  };

  const takeDown = () =>
    confirm("Take this story down?", "It goes for everyone.", "Delete", async () => {
      await api.remove(story!.id);
      if (list.length <= 1) close();
      else { q.refetch(); setIndex(Math.max(0, (index || 1) - 1)); }
    });

  if (q.error) {
    return (
      <View style={[styles.stage, { justifyContent: "center", alignItems: "center", padding: sp[6] }]}>
        {/* The stage is a black screen with nothing else on it: a server
            address and a fetch failure read worse here than anywhere. */}
        <Text style={{ color: "#fff", textAlign: "center" }}>
          {unreachable(q.error)
            ? q.error.offline
              ? "You're offline. Turn Wi-Fi or mobile data back on to see stories."
              : "Can't reach KaamKoRecord. Check your connection, or try again in a moment."
            : (q.error as Error).message}
        </Text>
        <Pressable onPress={close} style={{ marginTop: sp[4] }}><Text style={{ color: "#34d399", fontWeight: "700" }}>Close</Text></Pressable>
      </View>
    );
  }
  if (!q.data || !story) return <SkeletonStory top={insets.top} />;

  const shown = tally[story.id] || { my_emoji: story.my_emoji, reactions: story.reactions };

  return (
    <View style={styles.stage}>
      {story.kind === "video" ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
      ) : (
        <Image source={{ uri: story.image || undefined }} style={StyleSheet.absoluteFill} contentFit="contain" transition={100} />
      )}

      {/* Tap zones: the left third back, the rest on; hold anywhere to pause. */}
      <Pressable onPress={prev} onLongPress={hold} onPressOut={paused ? release : undefined} delayLongPress={180} style={[styles.zone, { left: 0, width: width / 3 }]} />
      <Pressable onPress={next} onLongPress={hold} onPressOut={paused ? release : undefined} delayLongPress={180} style={[styles.zone, { right: 0, width: (width * 2) / 3 }]} />

      <View style={[styles.head, { paddingTop: insets.top + 8 }]}>
        <View style={styles.bars}>
          {list.map((s, i) => (
            <View key={s.id} style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${i < index! ? 100 : i === index ? progress * 100 : 0}%` }]} />
            </View>
          ))}
        </View>
        <View style={styles.who}>
          <Avatar person={q.data.person} size={36} live={false} />
          <Text style={styles.name}>{q.data.name}</Text>
          <AdminBadge person={q.data.person} size={10} light />
          <Text style={styles.ago}>{story.ago}</Text>
          <VisibilityBadge visibility={story.visibility} size={12} light />
          <View style={{ flex: 1 }} />
          {paused ? <Ionicons name="pause" size={20} color="#fff" /> : null}
          <Pressable onPress={close} hitSlop={12} style={styles.close} accessibilityLabel="Close"><Ionicons name="close" size={26} color="#fff" /></Pressable>
        </View>
      </View>

      <View style={[styles.foot, { paddingBottom: insets.bottom + 12 }]}>
        {story.caption ? <View style={styles.caption}><Text style={styles.captionText}>{story.caption}</Text></View> : null}
        {story.mine ? (
          <View style={styles.own}>
            <Pressable onPress={() => setShowViewers((v) => !v)} style={styles.pill}>
              <Ionicons name="eye-outline" size={16} color="#fff" />
              <Text style={styles.pillText}>{story.seen_count ?? 0} view{story.seen_count === 1 ? "" : "s"}</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={takeDown} style={styles.pill}>
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={styles.pillText}>Delete</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.reactRow}>
            <EmojiRow mine={shown.my_emoji} onPick={react} choices={q.data.emoji} />
            <View style={styles.reactFoot}>
              {shown.reactions.length ? <Text style={styles.tally}>{shown.reactions.map((r) => `${r.emoji} ${r.count}`).join("   ")}</Text> : <View />}
              <Pressable onPress={() => { hold(); setReporting({ kind: "story", id: story.id, username: q.data!.person.username, excerpt: story.caption }); }} hitSlop={8} style={styles.reportPill} testID="story-report">
                <Ionicons name="flag-outline" size={14} color="#fff" />
                <Text style={styles.reportText}>Report</Text>
              </Pressable>
            </View>
          </View>
        )}
        {showViewers && story.mine ? (
          <View style={styles.viewers}>
            {(story.viewers || []).length === 0 ? <Text style={styles.viewer}>Nobody has looked yet.</Text> : null}
            {(story.viewers || []).map((v, i) => <Text key={i} style={styles.viewer}>{v.name} · {v.ago}</Text>)}
          </View>
        ) : null}
      </View>
      <ReportSheet target={reporting} onClose={() => { setReporting(null); release(); }} onBlocked={close} />
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: "#000" },
  zone: { position: "absolute", top: 90, bottom: 140 },
  head: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: sp[3] },
  bars: { flexDirection: "row", gap: 4 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.35)", overflow: "hidden" },
  barFill: { height: 3, backgroundColor: "#fff" },
  who: { flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[3] },
  name: { color: "#fff", fontWeight: "700", fontSize: 15 },
  ago: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  close: { padding: 4 },
  foot: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: sp[3], gap: sp[3] },
  caption: { alignSelf: "center", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "92%" },
  captionText: { color: "#fff", fontSize: 15, textAlign: "center" },
  own: { flexDirection: "row", alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  pillText: { color: "#fff", fontWeight: "700" },
  reactRow: { backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 24, paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  reactFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp[2], paddingHorizontal: 4 },
  tally: { color: "#fff", textAlign: "center", fontSize: 13 },
  reportPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.16)" },
  reportText: { color: "#fff", fontSize: 12.5, fontWeight: "600" },
  viewers: { backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 14, padding: sp[3], gap: 4 },
  viewer: { color: "#fff", fontSize: 14 },
});
