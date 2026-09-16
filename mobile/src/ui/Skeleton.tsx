/**
 * The shape of what is coming, breathing while it loads: grey blocks in
 * the places the words and badges will take, all pulsing together. A
 * screen shows these instead of a spinner so the eye already knows where
 * to look when the data lands.
 */
import React, { useRef } from "react";
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";

import { radius, sp, useTheme } from "./theme";

/** One shared pulse so every block on a screen breathes in step. */
let pulse: Animated.Value | null = null;
function usePulse() {
  if (!pulse) {
    pulse = new Animated.Value(0);
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
  }
  return pulse;
}

export function Bone({ width = "100%", height = 14, round = 8, style }: { width?: DimensionValue; height?: number; round?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const pulse = usePulse();
  const opacity = useRef(pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] })).current;
  return <Animated.View style={[{ width, height, borderRadius: round, backgroundColor: t.surface3, opacity }, style]} />;
}

/** A list of rows, each a badge and two lines — a PLU result before it arrives. */
export function SkeletonRows({ count = 6, badge = true }: { count?: number; badge?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.list, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent" }]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
          {badge ? <Bone width={58} height={36} round={radius.sm} /> : null}
          <View style={{ flex: 1, gap: 8 }}>
            <Bone width={`${55 + ((i * 17) % 35)}%`} height={15} />
            <Bone width={`${25 + ((i * 11) % 30)}%`} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingHorizontal: sp[4], minHeight: 64 },
});
