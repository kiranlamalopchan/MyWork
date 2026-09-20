/**
 * Posting a story: a photo or a video from the camera or the library, a
 * line under it, Share. Two big tiles to start; then the picture fills a
 * tall card with the caption and Share under it, and a bar shows the
 * upload going (and the server converting a video afterwards). A clip
 * over sixty seconds gets a window to slide along it; the server cuts it
 * there and converts it, as it does for the site.
 */
import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

import { stories as api, useStoriesChanged, type Visibility } from "@/api";
import { goBack } from "@/nav/paths";
import type { FilePart } from "@/api/client";
import { Button, Field, Input, Page, PageTitle, Screen } from "@/ui";
import { VisibilityPicker } from "@/ui/VisibilityPicker";
import { useLayout } from "@/ui/layout";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { fail, success, tap, tick } from "@/ui/haptics";

const MAX_SECONDS = 60;
type Picked = ImagePicker.ImagePickerAsset;

export default function ComposeStory() {
  const t = useTheme();
  const layout = useLayout();
  const changed = useStoriesChanged();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [start, setStart] = useState(0);
  const [trackWidth, setTrackWidth] = useState(1);

  const isVideo = picked?.type === "video";
  const seconds = isVideo && picked?.duration ? picked.duration / 1000 : 0;
  const needsCut = seconds > MAX_SECONDS + 0.5;
  const span = Math.min(MAX_SECONDS, seconds);

  const pick = async (from: "library" | "camera") => {
    tick();
    setError("");
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      videoMaxDuration: 0,
    };
    try {
      let result: ImagePicker.ImagePickerResult | null = null;
      if (from === "camera") {
        if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) { setError("The camera isn't allowed. Choose from the library instead, or allow it in Settings."); return; }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }
      if (!result || result.canceled) return;
      setPicked(result.assets[0]);
      setStart(0);
    } catch (e: any) {
      setError(e?.message || "That couldn't be opened.");
    }
  };

  // The preview player is made once, empty, and given the clip when one is
  // picked (the hook reads its source only the first time).
  const player = useVideoPlayer(null, (p) => { p.loop = true; p.muted = true; });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  React.useEffect(() => {
    try { player.replace(isVideo && picked ? { uri: picked.uri } : null); } catch {}
  }, [picked?.uri]);
  React.useEffect(() => { if (isVideo && status === "readyToPlay") player.play(); }, [status, picked?.uri]);
  React.useEffect(() => { if (isVideo) { player.currentTime = start; } }, [start]);

  // The window: drag along the track to choose where the minute begins.
  const drag = useMemo(
    () => Gesture.Pan().onUpdate((e) => {
      const room = Math.max(seconds - span, 0);
      const s = Math.min(Math.max((e.x / trackWidth) * seconds - span / 2, 0), room);
      setStart(Math.round(s * 10) / 10);
    }).runOnJS(true),
    [seconds, span, trackWidth]
  );

  const share = async () => {
    if (!picked) return;
    tap("medium");
    setError("");
    setBusy(true);
    setSent(0);
    try {
      const name = picked.fileName || (isVideo ? "story.mp4" : "story.jpg");
      const type = picked.mimeType || (isVideo ? "video/mp4" : "image/jpeg");
      const file: FilePart = Platform.OS === "web" ? (await webFile(picked.uri, name, type)) : { uri: picked.uri, name, type };
      const fields = isVideo
        ? { video: file, caption, visibility, duration: seconds || undefined, trim_start: needsCut ? start : undefined, trim_end: needsCut ? start + span : undefined }
        : { image: file, caption, visibility };
      await api.post(fields, setSent);
      success();
      changed();
      goBack();
    } catch (e: any) {
      fail();
      setError(e?.message || "That couldn't be shared.");
    } finally {
      setBusy(false);
    }
  };

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const uploading = busy && sent < 0.999;
  const stage = !busy ? "" : uploading ? `Uploading ${Math.round(sent * 100)}%` : isVideo ? (needsCut ? `Cutting it to ${Math.round(span)} seconds and converting it…` : "Converting it to 1080p…") : "Nearly there…";
  const previewWidth = Math.min(340, layout.width - 2 * layout.gutter);

  return (
    <Screen back backLabel="Home">
      <Page>
        <PageTitle sub="A photo or a video, up for 24 hours.">New story</PageTitle>

        {!picked ? (
          <>
            {/* Two ways in: the camera, the library. */}
            <View style={[styles.tiles, layout.compact && { flexDirection: "column" }]}>
              {Platform.OS !== "web" ? (
                <Source icon="camera" colour={t.violet} title="Camera" sub="Take one now" onPress={() => pick("camera")} testID="story-camera" />
              ) : null}
              <Source icon="images" colour={t.blue} title="Library" sub="A photo or video you have" onPress={() => pick("library")} testID="story-library" />
            </View>
            <View style={[styles.note, { backgroundColor: t.surface2 }]}>
              <Ionicons name="time-outline" size={18} color={t.muted} />
              <Text style={{ color: t.muted, fontSize: 13.5, flex: 1, lineHeight: 19 }}>Everyone signed in sees it for a day. A video keeps up to {MAX_SECONDS} seconds.</Text>
            </View>
            {error ? <Notice text={error} /> : null}
          </>
        ) : (
          <>
            {/* The picture, tall, with the way to swap it in the corner. */}
            <View style={[styles.preview, { width: previewWidth, backgroundColor: "#000" }, !t.dark && styles.previewShadow]}>
              {isVideo ? (
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={Platform.OS !== "web"} />
              ) : (
                <Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              )}
              {!busy ? (
                <Pressable onPress={() => { tick(); setPicked(null); setError(""); }} accessibilityLabel="Choose another" style={styles.swap}>
                  <Ionicons name="close" size={20} color="#fff" />
                </Pressable>
              ) : null}
              {isVideo ? (
                <View style={styles.length}>
                  <Ionicons name="videocam" size={14} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12.5 }}>{clock(needsCut ? span : seconds)}</Text>
                </View>
              ) : null}
            </View>

            {isVideo && needsCut ? (
              <View style={[styles.trim, { backgroundColor: t.surface }]}>
                <Text style={{ color: t.text, fontWeight: "700", fontSize: 14.5 }}>Keeping {clock(start)} – {clock(start + span)} of {clock(seconds)}</Text>
                <GestureDetector gesture={drag}>
                  <View style={[styles.track, { backgroundColor: t.surface3 }]} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
                    <View style={[styles.window, { left: `${(start / seconds) * 100}%`, width: `${(span / seconds) * 100}%`, borderColor: t.brand, backgroundColor: alpha(t.brand, 0.18) }]} />
                  </View>
                </GestureDetector>
                <Text style={{ color: t.muted, fontSize: 13 }}>Drag the window to the part to keep.</Text>
              </View>
            ) : null}

            <Input placeholder="Say something (optional)" value={caption} onChangeText={setCaption} maxLength={200} editable={!busy} />
            <Field label="Who can see this">
              <VisibilityPicker value={visibility} onChange={setVisibility} />
            </Field>

            {busy ? (
              <View style={{ gap: sp[2] }}>
                <View style={[styles.barTrack, { backgroundColor: t.surface3 }]}>
                  <View style={[styles.barFill, { backgroundColor: t.brand, width: `${Math.max(4, Math.round((uploading ? sent : 1) * 100))}%` }]} />
                </View>
                <Text style={{ color: t.muted, fontSize: 13.5, textAlign: "center" }}>{stage}</Text>
              </View>
            ) : null}
            {error ? <Notice text={error} /> : null}

            <Button title={busy ? "Sharing…" : "Share"} icon="paper-plane" onPress={share} busy={busy} testID="story-share" />
          </>
        )}
      </Page>
    </Screen>
  );
}

/** A big tile: the icon on its colour, the word, the line under it. */
function Source({ icon, colour, title, sub, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; colour: string; title: string; sub: string; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.tile, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent", transform: [{ scale: pressed ? 0.97 : 1 }] }, !t.dark && styles.previewShadow]}>
      <View style={[styles.tileIcon, { backgroundColor: alpha(colour, 0.14) }]}>
        <Ionicons name={icon} size={28} color={colour} />
      </View>
      <Text style={{ color: t.text, fontWeight: "800", fontSize: 17, letterSpacing: -0.3 }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 13.5 }}>{sub}</Text>
    </Pressable>
  );
}

function Notice({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={[styles.note, { backgroundColor: t.dangerSoft }]}>
      <Ionicons name="alert-circle" size={18} color={t.danger} />
      <Text style={{ color: t.danger, fontSize: 14, flex: 1, lineHeight: 20 }}>{text}</Text>
    </View>
  );
}

/** On the web build a picked file is a blob: URL; FormData wants the File. */
async function webFile(uri: string, name: string, type: string): Promise<FilePart> {
  const blob = await (await fetch(uri)).blob();
  return new File([blob], name, { type }) as unknown as FilePart;
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: sp[3] },
  tile: { flex: 1, alignItems: "center", gap: 4, paddingVertical: sp[6], paddingHorizontal: sp[4], borderRadius: radius.xl, borderWidth: 1 },
  tileIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: sp[2] },
  note: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], paddingHorizontal: sp[4], borderRadius: radius.md },
  preview: { aspectRatio: 9 / 16, alignSelf: "center", borderRadius: radius.xl, overflow: "hidden" },
  previewShadow: { shadowColor: "#1a2540", shadowOpacity: 0.12, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  swap: { position: "absolute", top: 12, right: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  length: { position: "absolute", left: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.55)" },
  trim: { gap: sp[2], padding: sp[4], borderRadius: radius.lg },
  track: { height: 44, borderRadius: radius.sm, overflow: "hidden" },
  window: { position: "absolute", top: 0, bottom: 0, borderWidth: 3, borderRadius: radius.sm },
  barTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
});
