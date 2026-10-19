/** A face: the photo, or the initial on the person's own hue, with the live dot. */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";

import type { Person } from "@/api";

import { hsl, useTheme } from "./theme";

/** The site's "here now" green (.avatar__live), the same in both themes. */
const LIVE = "#22c55e";
const LIVE_HALO = "rgba(34, 197, 94, 0.45)";

export function Avatar({ person, size = 40, live, ring, dotRing }: { person: Pick<Person, "initial" | "hue" | "photo" | "is_live">; size?: number; live?: boolean; ring?: string; dotRing?: string }) {
  const t = useTheme();
  const showLive = live ?? person.is_live;
  return (
    <View style={{ width: size, height: size }}>
      {person.photo ? (
        <Image source={{ uri: person.photo }} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 2 : 0, borderColor: ring }} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2, backgroundColor: hsl(person.hue), borderWidth: ring ? 2 : 0, borderColor: ring }]}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{person.initial}</Text>
        </View>
      )}
      {showLive ? <LiveDot size={size} ring={dotRing ?? t.surface} /> : null}
    </View>
  );
}

/**
 * The dot on the corner of somebody's face while they are here, as the site
 * draws it: half outside the circle, a ring of whatever it sits on to part it
 * from the face, a faint green halo, and a slow breath — presence, not an
 * alert. Still when the phone asks for reduced motion or the app is away.
 */
function LiveDot({ size, ring }: { size: number; ring: string }) {
  const dot = size >= 64 ? 20 : size >= 30 ? 11 : 8;
  const edge = size >= 64 ? 3 : 2;
  const outer = dot + (edge + 1) * 2;
  const breath = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true), [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const state = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; reduce.remove(); state.remove(); };
  }, []);
  useEffect(() => {
    breath.setValue(1);
    if (reduced || !active) return;
    const half = { duration: 1600, useNativeDriver: true };
    const animation = Animated.loop(Animated.sequence([Animated.timing(breath, { ...half, toValue: 0.72 }), Animated.timing(breath, { ...half, toValue: 1 })]));
    animation.start(); return () => animation.stop();
  }, [breath, reduced, active]);
  return (
    <Animated.View
      pointerEvents="none"
      testID="live-dot"
      style={[styles.halo, { width: outer, height: outer, borderRadius: outer / 2, right: -1 - edge - 1, bottom: -1 - edge - 1, opacity: breath }]}
    >
      <View style={{ width: dot + edge * 2, height: dot + edge * 2, borderRadius: (dot + edge * 2) / 2, borderWidth: edge, borderColor: ring, backgroundColor: LIVE }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  initial: { alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", alignItems: "center", justifyContent: "center", backgroundColor: LIVE_HALO },
});
