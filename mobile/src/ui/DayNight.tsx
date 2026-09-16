/**
 * Day and night: the switch in the app bar. A knob carrying the sun slides
 * across a sky to become a moon in a night with stars — the site's
 * .daynight, on the same spring.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { tick } from "./haptics";
import { useThemeMode } from "./theme";

const TRACK_W = 52, TRACK_H = 30, KNOB = 24, GAP = 3;
const TRAVEL = TRACK_W - KNOB - 2 * GAP;
const STARS = [[11, 9, 1.3], [19, 19, 1], [27, 7, 1.5], [8, 21, 1], [22, 12, 1.1]] as const;

export function DayNight() {
  const { isDark, toggle } = useThemeMode();
  const night = useRef(new Animated.Value(isDark ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(night, { toValue: isDark ? 1 : 0, duration: 450, easing: Easing.bezier(0.34, 1.4, 0.64, 1), useNativeDriver: false }).start();
  }, [isDark, night]);

  const knobX = night.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });
  const knobColour = night.interpolate({ inputRange: [0, 1], outputRange: ["#fff4c2", "#e2e8f0"] });
  const sunOpacity = night.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const sunSpin = night.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-100deg"] });
  const moonSpin = night.interpolate({ inputRange: [0, 1], outputRange: ["100deg", "0deg"] });
  const starsX = night.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });

  return (
    <Pressable onPress={() => { tick(); toggle(); }} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: isDark }} accessibilityLabel={isDark ? "Switch to day" : "Switch to night"} testID="daynight" style={styles.hit}>
      <View style={styles.track}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#9fd3f7" }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: night, backgroundColor: "#141f3a" }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: night, transform: [{ translateX: starsX }] }]}>
          {STARS.map(([x, y, r], i) => (
            <View key={i} style={{ position: "absolute", left: x - r / 2, top: y - r / 2, width: r, height: r, borderRadius: r, backgroundColor: "#fff" }} />
          ))}
        </Animated.View>
        <Animated.View style={[styles.knob, { backgroundColor: knobColour, transform: [{ translateX: knobX }] }]}>
          <Animated.View style={[styles.face, { opacity: sunOpacity, transform: [{ rotate: sunSpin }] }]}>
            <Ionicons name="sunny" size={15} color="#f59e0b" />
          </Animated.View>
          <Animated.View style={[styles.face, { opacity: night, transform: [{ rotate: moonSpin }] }]}>
            <Ionicons name="moon" size={13} color="#334155" />
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  track: { width: TRACK_W, height: TRACK_H, borderRadius: 999, overflow: "hidden" },
  knob: {
    position: "absolute", top: GAP, left: GAP, width: KNOB, height: KNOB, borderRadius: KNOB / 2,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#0f172a", shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  face: { position: "absolute", alignItems: "center", justifyContent: "center" },
});
