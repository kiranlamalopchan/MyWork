/**
 * Posting a story: a photo or a video from the phone's library or camera,
 * a line under it, Share. A clip over sixty seconds gets a window to slide
 * along it; the server cuts it there and converts it, as it does for the
 * site. (On iOS the picker's own trimmer appears too, when editing is
 * allowed.)
 */
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";

import { stories as api, useStoriesChanged } from "@/api";
import { goBack } from "@/nav/paths";
import type { FilePart } from "@/api/client";
import { Button, Input, Screen, Sub } from "@/ui";
import { radius, sp, useTheme } from "@/ui/theme";

const MAX_SECONDS = 60;
type Picked = ImagePicker.ImagePickerAsset;

export default function ComposeStory() {
  const t = useTheme();
  const changed = useStoriesChanged();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(0);
  const [trackWidth, setTrackWidth] = useState(1);

  const isVideo = picked?.type === "video";
  const seconds = isVideo && picked?.duration ? picked.duration / 1000 : 0;
  const needsCut = seconds > MAX_SECONDS + 0.5;
  const span = Math.min(MAX_SECONDS, seconds);

  const pick = async (from: "library" | "camera") => {
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
        if ((await ImagePicker.requestCameraPermissionsAsync()).granted) result = await ImagePicker.launchCameraAsync(options);
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

  const player = useVideoPlayer(isVideo ? picked!.uri : null, (p) => { p.loop = true; p.muted = true; });
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
    setError("");
    setBusy(true);
    try {
      const name = picked.fileName || (isVideo ? "story.mp4" : "story.jpg");
      const type = picked.mimeType || (isVideo ? "video/mp4" : "image/jpeg");
      const file: FilePart = Platform.OS === "web" ? (await webFile(picked.uri, name, type)) : { uri: picked.uri, name, type };
      if (isVideo) {
        await api.post({
          video: file, caption,
          duration: seconds || undefined,
          trim_start: needsCut ? start : undefined,
          trim_end: needsCut ? start + span : undefined,
        });
      } else {
        await api.post({ image: file, caption });
      }
      changed();
      goBack();
    } catch (e: any) {
      setError(e?.message || "That couldn't be shared.");
    } finally {
      setBusy(false);
    }
  };

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: sp[4], gap: sp[3] }} keyboardShouldPersistTaps="handled">
        {!picked ? (
          <View style={[styles.drop, { borderColor: t.lineStrong, backgroundColor: t.surface2 }]}>
            <Ionicons name="camera-outline" size={36} color={t.brand} />
            <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Choose a photo or video</Text>
            <Sub>Any photo, or a video — up to {MAX_SECONDS} seconds of it. Up for 24 hours.</Sub>
            <View style={{ flexDirection: "row", gap: sp[2], marginTop: sp[2] }}>
              <Button title="Library" icon="images-outline" kind="plain" onPress={() => pick("library")} />
              {Platform.OS !== "web" ? <Button title="Camera" icon="camera-outline" kind="plain" onPress={() => pick("camera")} /> : null}
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.preview, { backgroundColor: "#000" }]}>
              {isVideo ? (
                <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={Platform.OS !== "web"} />
              ) : (
                <Image source={{ uri: picked.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
              )}
            </View>
            {isVideo ? (
              needsCut ? (
                <View style={{ gap: sp[2] }}>
                  <Sub style={{ textAlign: "center" }}>Keeping {clock(start)} – {clock(start + span)} ({Math.round(span)} s) of {clock(seconds)}</Sub>
                  <GestureDetector gesture={drag}>
                    <View style={[styles.track, { backgroundColor: t.surface3 }]} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
                      <View style={[styles.window, { left: `${(start / seconds) * 100}%`, width: `${(span / seconds) * 100}%`, borderColor: t.brand }]} />
                    </View>
                  </GestureDetector>
                  <Sub style={{ textAlign: "center" }}>Drag the window to choose the part to keep.</Sub>
                </View>
              ) : (
                <Sub style={{ textAlign: "center" }}>{Math.round(seconds)} seconds</Sub>
              )
            ) : null}
            <Input placeholder="Say something (optional)" value={caption} onChangeText={setCaption} maxLength={200} />
            {error ? <Text style={{ color: t.danger }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: sp[2] }}>
              <Button title="Choose another" kind="plain" onPress={() => { setPicked(null); setError(""); }} style={{ flex: 1 }} />
              <Button title={busy ? "Sharing…" : "Share"} onPress={share} busy={busy} style={{ flex: 1 }} />
            </View>
            {busy && isVideo ? <Sub style={{ textAlign: "center" }}>{needsCut ? `Cutting it to ${Math.round(span)} seconds` : "Converting it to 1080p"} — up to a minute.</Sub> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** On the web build a picked file is a blob: URL; FormData wants the File. */
async function webFile(uri: string, name: string, type: string): Promise<FilePart> {
  const blob = await (await fetch(uri)).blob();
  return new File([blob], name, { type }) as unknown as FilePart;
}

const styles = StyleSheet.create({
  drop: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: radius.lg, padding: sp[6], alignItems: "center", gap: sp[2], minHeight: 240, justifyContent: "center" },
  preview: { width: "100%", maxWidth: 300, aspectRatio: 9 / 16, alignSelf: "center", borderRadius: radius.md, overflow: "hidden" },
  track: { height: 44, borderRadius: radius.sm, overflow: "hidden" },
  window: { position: "absolute", top: 0, bottom: 0, borderWidth: 3, borderRadius: radius.sm, backgroundColor: "rgba(5,150,105,0.18)" },
});
