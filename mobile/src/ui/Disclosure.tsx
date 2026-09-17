/**
 * An expandable list item, Material-style: a leading icon in its own tonal
 * container, a title with a supporting line, and a chevron that turns as
 * the item opens. Several of them stack inside one panel with a hairline
 * between, the way a settings list does — the profile's Friends, Statement
 * and Activity are three of these on one surface.
 *
 * The fold runs on the native thread (reanimated): the body is always
 * laid out so its height is known, and a clipped window over it grows and
 * shrinks with the chevron's turn. Which item is open is the owner's to
 * decide, so a list can keep to one at a time.
 */
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { tick } from "./haptics";
import { alpha, sp, useTheme } from "./theme";

const TIMING = { duration: 280, easing: Easing.out(Easing.cubic) };

export function Disclosure({ icon, tint, title, hint, open, onToggle, children, last, testID }: {
  icon: keyof typeof Ionicons.glyphMap; tint?: string; title: string; hint?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode; last?: boolean; testID?: string;
}) {
  const t = useTheme();
  const ink = tint || t.brand;
  const progress = useSharedValue(open ? 1 : 0);
  const content = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, TIMING);
  }, [open, progress]);

  const window = useAnimatedStyle(() => ({ height: progress.value * content.value, opacity: progress.value }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 180}deg` }] }));

  return (
    <View testID={testID} style={{ borderBottomColor: t.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }}>
      <Pressable
        onPress={() => { tick(); onToggle(); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.head, { backgroundColor: pressed ? alpha(ink, 0.08) : "transparent" }]}
      >
        <View style={[styles.icon, { backgroundColor: alpha(ink, 0.14) }]}>
          <Ionicons name={icon} size={20} color={ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{title}</Text>
          {hint ? <Text style={[styles.hint, { color: t.muted }]} numberOfLines={1}>{hint}</Text> : null}
        </View>
        <Animated.View style={chevron}>
          <Ionicons name="chevron-down" size={20} color={t.muted} />
        </Animated.View>
      </Pressable>
      <Animated.View style={[styles.window, window]} pointerEvents={open ? "auto" : "none"}>
        <View
          style={styles.body}
          onLayout={(e) => { content.value = withTiming(e.nativeEvent.layout.height, TIMING); }}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "600", letterSpacing: -0.1 },
  hint: { fontSize: 13.5, marginTop: 2 },
  window: { overflow: "hidden" },
  // Laid out off the window's flow so its natural height can be measured
  // whatever the window is showing of it.
  body: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: sp[4], paddingBottom: sp[5], gap: sp[4] },
});
