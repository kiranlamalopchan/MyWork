/**
 * The row of faces to react with, the way a social app pops it open: a
 * pill floating above the React button, each face arriving a beat after
 * the one before, then moving in its own small way — the thumb tips, the
 * heart beats, the hug rocks, haha laughs, wow rises, sad droops, angry
 * shakes (the site's .picker, in motion). A face grows under the thumb
 * with a tick, and picking it knocks. The one already yours sits on a
 * ring, so the row says which tap takes it back. `ReactionSheet` is the
 * same row floating over the whole screen, so a tap anywhere else closes it.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import type { Emoji } from "@/api";

import { tap, tick } from "./haptics";
import { EMOJI } from "./index";
import { radius, useTheme } from "./theme";

const FACE = 44;

/** Each face's gesture: what moves, how far, and how long a cycle takes. */
const MOTION: Record<string, { ms: number; style: (v: Animated.Value) => Record<string, unknown> }> = {
  "👍": { ms: 1600, style: (v) => ({ transform: [{ rotate: v.interpolate({ inputRange: [0, 0.3, 0.6, 1], outputRange: ["0deg", "-14deg", "4deg", "0deg"] }) }, { translateY: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -1, 0] }) }] }) },
  "❤️": { ms: 1100, style: (v) => ({ transform: [{ scale: v.interpolate({ inputRange: [0, 0.25, 0.45, 0.6, 1], outputRange: [1, 1.14, 1, 1.1, 1] }) }] }) },
  "🥰": { ms: 1800, style: (v) => ({ transform: [{ rotate: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-7deg", "7deg", "-7deg"] }) }] }) },
  "😂": { ms: 900, style: (v) => ({ transform: [{ translateY: v.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: [0, -3, -3, 0] }) }, { rotate: v.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: ["0deg", "-6deg", "6deg", "0deg"] }) }] }) },
  "😮": { ms: 1800, style: (v) => ({ transform: [{ translateY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -3, 0] }) }, { scale: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] }) }] }) },
  "😢": { ms: 2200, style: (v) => ({ transform: [{ translateY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 3, 0] }) }, { rotate: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "-3deg", "0deg"] }) }] }) },
  "😡": { ms: 500, style: (v) => ({ transform: [{ translateX: v.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: [0, -1.5, 1.5, 0] }) }, { rotate: v.interpolate({ inputRange: [0, 0.25, 0.75, 1], outputRange: ["0deg", "-3deg", "3deg", "0deg"] }) }] }) },
};

export function ReactionPicker({ mine, onPick, choices = EMOJI, align = "left", style }: {
  mine: string; onPick: (emoji: string) => void; choices?: Emoji[]; align?: "left" | "right" | "center"; style?: Record<string, unknown>;
}) {
  const t = useTheme();
  const open = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(open, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 220, mass: 0.7 }).start();
  }, [open]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.pill,
        { backgroundColor: t.dark ? t.surface3 : t.surface, borderColor: t.dark ? t.lineStrong : "transparent" },
        align === "right" ? { right: 0 } : align === "center" ? { alignSelf: "center" } : { left: 0 },
        shadow(t.dark),
        { opacity: open, transform: [{ translateY: open.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: open.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] },
        style,
      ]}
    >
      {choices.map((e, i) => <Face key={e.value} emoji={e} index={i} on={mine === e.value} onPick={onPick} />)}
    </Animated.View>
  );
}

/** Where something sits on the screen, from `measureInWindow`. */
export type Anchor = { x: number; y: number; width: number; height: number };

/**
 * The row over the whole screen, just above the thing that opened it
 * (kept inside the screen's edges), and a tap anywhere else puts it away.
 */
export function ReactionSheet({ anchor, mine, onPick, onClose, choices = EMOJI }: { anchor: Anchor | null; mine: string; onPick: (emoji: string) => void; onClose: () => void; choices?: Emoji[] }) {
  const { width } = useWindowDimensions();
  if (!anchor) return null;
  const pillWidth = choices.length * FACE + 10;
  const left = Math.min(anchor.x, Math.max(8, width - pillWidth - 8));
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close faces" />
      <View style={{ position: "absolute", top: anchor.y, left, height: 0 }}>
        <ReactionPicker mine={mine} onPick={onPick} choices={choices} />
      </View>
    </Modal>
  );
}

function Face({ emoji, index, on, onPick }: { emoji: Emoji; index: number; on: boolean; onPick: (emoji: string) => void }) {
  const t = useTheme();
  const arrive = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const cycle = useRef(new Animated.Value(0)).current;
  const motion = MOTION[emoji.value];

  useEffect(() => {
    // A beat after the one before, the way the row pops open on a phone.
    Animated.spring(arrive, { toValue: 1, delay: index * 40, useNativeDriver: true, damping: 12, stiffness: 260, mass: 0.6 }).start();
    if (!motion) return;
    const loop = Animated.loop(Animated.timing(cycle, { toValue: 1, duration: motion.ms, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [arrive, cycle, index, motion]);

  const grow = (to: number) => Animated.spring(press, { toValue: to, useNativeDriver: true, damping: 10, stiffness: 300 }).start();

  return (
    <Pressable
      onPressIn={() => { tick(); grow(1.45); }}
      onPressOut={() => grow(1)}
      onPress={() => { tap("medium"); onPick(emoji.value); }}
      accessibilityLabel={emoji.label}
      accessibilityState={{ selected: on }}
      hitSlop={2}
      style={styles.face}
    >
      {on ? <View style={[styles.ring, { backgroundColor: t.brandSoft, borderColor: t.brand }]} /> : null}
      <Animated.View style={{ opacity: arrive, transform: [{ translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: Animated.multiply(arrive.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), press) }] }}>
        <Animated.Text style={[styles.glyph, motion ? motion.style(cycle) : null]}>{emoji.value}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const shadow = (dark: boolean) =>
  Platform.OS === "android" ? { elevation: 8 } : { shadowColor: "#0f1420", shadowOpacity: dark ? 0.5 : 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } };

const styles = StyleSheet.create({
  pill: { position: "absolute", bottom: "100%", marginBottom: 6, flexDirection: "row", alignItems: "center", padding: 4, borderRadius: radius.pill, borderWidth: 1, zIndex: 30 },
  face: { width: FACE, height: FACE, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", top: 3, left: 3, right: 3, bottom: 3, borderRadius: FACE / 2, borderWidth: 2 },
  glyph: { fontSize: 32, lineHeight: 40, textAlign: "center", ...(Platform.OS === "web" ? { userSelect: "none" as const } : {}) },
});
