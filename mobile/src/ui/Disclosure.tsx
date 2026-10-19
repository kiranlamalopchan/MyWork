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
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { useComeUp } from "./depth";
import { tick } from "./haptics";
import { alpha, sp, useTheme } from "./theme";

const TIMING = { duration: 280, easing: Easing.out(Easing.cubic) };

/**
 * The fold on its own, for a list that draws its own heads (the timesheet's
 * days and weeks): a clipped window over `children` that opens to their
 * height and closes to nothing, the contents easing down into place as it
 * opens. Always laid out, so the height is known before the first opening.
 */
export function Fold({ open, children, style }: { open: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const progress = useSharedValue(open ? 1 : 0);
  const content = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, TIMING);
  }, [open, progress]);
  const window = useAnimatedStyle(() => ({ height: progress.value * content.value, opacity: progress.value }));
  const settle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * -10 }] }));
  return (
    <Animated.View style={[styles.window, window]} pointerEvents={open ? "auto" : "none"}>
      <Animated.View
        style={[styles.foldBody, style, settle]}
        onLayout={(e) => { content.value = withTiming(e.nativeEvent.layout.height, TIMING); }}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

/** The chevron that turns over as a fold opens, in step with it. */
export function FoldChevron({ open, size = 18, colour }: { open: boolean; size?: number; colour: string }) {
  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, TIMING);
  }, [open, progress]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 180}deg` }] }));
  return <Animated.View style={turn}><Ionicons name="chevron-down" size={size} color={colour} /></Animated.View>;
}

export function Disclosure({ icon, tint, title, hint, open, onToggle, children, last, testID, minimal = false, badge }: {
  icon: keyof typeof Ionicons.glyphMap; tint?: string; title: string; hint?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode; last?: boolean; testID?: string; minimal?: boolean; badge?: number;
}) {
  const t = useTheme();
  const ink = tint || t.brand;
  const root = useComeUp(open);
  const progress = useSharedValue(open ? 1 : 0);
  const content = useSharedValue(0);
  useEffect(() => {
    progress.value = minimal ? (open ? 1 : 0) : withTiming(open ? 1 : 0, TIMING);
  }, [open, progress, minimal]);

  const window = useAnimatedStyle(() => ({ height: progress.value * content.value, opacity: progress.value }));
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.value * 180}deg` }] }));

  return (
    <View ref={root} testID={testID} style={{ borderBottomColor: t.line, borderBottomWidth: minimal || last ? 0 : StyleSheet.hairlineWidth }}>
      <Pressable
        onPress={() => { tick(); onToggle(); }}
        accessibilityRole="button"
        accessibilityLabel={minimal ? (hint ? `${title}. ${hint}` : title) : undefined}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.head, minimal && styles.minimalHead, { backgroundColor: pressed ? alpha(ink, 0.08) : "transparent" }]}
      >
        <View style={[styles.icon, { backgroundColor: alpha(ink, 0.14) }, minimal && styles.minimalIcon]}>
          <Ionicons name={icon} size={20} color={minimal ? t.text2 : ink} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, minimal && styles.minimalTitle, { color: t.text }]} numberOfLines={1}>{title}</Text>
          {hint && !minimal ? <Text style={[styles.hint, { color: t.muted }]} numberOfLines={1}>{hint}</Text> : null}
        </View>
        {badge ? <View style={[styles.badge, { backgroundColor: t.brandSoft }]}><Text style={{ color: t.brand, fontSize: 12, fontWeight: "600" }}>{badge}</Text></View> : null}
        <Animated.View style={chevron}>
          <Ionicons name="chevron-down" size={20} color={t.muted} />
        </Animated.View>
      </Pressable>
      {minimal ? (open ? <View style={styles.staticBody}>{children}</View> : null) : <Animated.View style={[styles.window, window]} pointerEvents={open ? "auto" : "none"}>
        <View
          style={styles.body}
          onLayout={(e) => { content.value = withTiming(e.nativeEvent.layout.height, TIMING); }}
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        >
          {children}
        </View>
      </Animated.View>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, justifyContent: "center", alignItems: "center" },
  staticBody: { paddingHorizontal: 22, paddingBottom: 20, paddingTop: 4, gap: 16 },
  minimalHead: { minHeight: 60, paddingHorizontal: 22, paddingVertical: 16, gap: 18 },
  minimalIcon: { width: 20, height: 24, borderRadius: 0, backgroundColor: "transparent" },
  minimalTitle: { fontSize: 15, fontWeight: "400" },
  head: { flexDirection: "row", alignItems: "center", gap: sp[4], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 72 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "600", letterSpacing: -0.1 },
  hint: { fontSize: 13.5, marginTop: 2 },
  window: { overflow: "hidden" },
  foldBody: { position: "absolute", left: 0, right: 0, top: 0 },
  // Laid out off the window's flow so its natural height can be measured
  // whatever the window is showing of it.
  body: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: sp[4], paddingBottom: sp[5], gap: sp[4] },
});
