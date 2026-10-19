/**
 * The Pay tab's wallet effect, for every row that slides sideways: whatever is
 * in full view is sharp and full size; whatever is crossing the row's edge
 * shrinks a little and frosts over, coming back into focus as it is slid in.
 *
 * Driven by the scroll position on the native thread. Real blur where the
 * platform draws it — iOS — and a plain wash on Android, where
 * expo-blur needs a blur target set up around the whole screen.
 */
import React, { useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";

import { nativeOrNull } from "./native";
import { alpha, useTheme } from "./theme";

export const FrostBlur = Platform.OS === "ios" ? nativeOrNull(() => require("expo-blur").BlurView as typeof import("expo-blur").BlurView) : null;

/**
 * The frosted pane laid over an item; `opacity` 0 is clear, 1 fully frosted.
 * `on` is what the row sits on — the page's ground, or a card's white — so the
 * wash melts into it instead of greying the item.
 */
export function Frost({ opacity, radius, on = "page" }: { opacity: Animated.AnimatedInterpolation<number> | Animated.Value | number; radius: number; on?: "page" | "card" }) {
  const t = useTheme();
  const ground = on === "card" ? t.surface : t.bg;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden", opacity }]}>
      {FrostBlur ? <FrostBlur intensity={t.dark ? 30 : 22} tint={t.dark ? "dark" : "light"} style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(ground, FrostBlur ? 0.25 : 0.6) }]} />
    </Animated.View>
  );
}

/**
 * The scroll position of one sideways row, and the handler that feeds it.
 * `listener` still sees every scroll event, for anything that needs the
 * offset in JS (keeping a selection in view, settling a swipe).
 */
export function useRailScroll(listener?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void) {
  const x = useRef(new Animated.Value(0)).current;
  const [viewport, setViewport] = useState(0);
  const latest = useRef(listener);
  latest.current = listener;
  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { x } } }], {
    useNativeDriver: true,
    listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => latest.current?.(event),
  }), [x]);
  return { x, onScroll, viewport, setViewport };
}

/**
 * One item in such a row. It measures where it sits in the row, and from the
 * scroll position works out how far it hangs past either edge: none, and it is
 * sharp; all of its width, and it is fully frosted and shrunk.
 */
export function EdgeItem({ x, viewport, radius, shrink = 0.9, on, style, onMeasure, children }: {
  x: Animated.Value; viewport: number; radius: number; shrink?: number; on?: "page" | "card"; style?: StyleProp<ViewStyle>;
  onMeasure?: (box: { x: number; width: number }) => void; children: React.ReactNode;
}) {
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const ready = !!box && viewport > 0 && box.width > 0 && box.width <= viewport;
  // Scroll offsets at which this item is: wholly off the right edge · just fully in at the right · just fully in at the left · wholly off the left edge.
  const range = ready ? [box.left + box.width - viewport - box.width, box.left + box.width - viewport, box.left, box.left + box.width] : [0, 1];
  const frost = ready ? x.interpolate({ inputRange: range, outputRange: [1, 0, 0, 1], extrapolate: "clamp" }) : 0;
  const scale = ready ? x.interpolate({ inputRange: range, outputRange: [shrink, 1, 1, shrink], extrapolate: "clamp" }) : 1;
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]} onLayout={(e) => {
      const { x: left, width } = e.nativeEvent.layout;
      onMeasure?.({ x: left, width });
      setBox((prev) => (prev && prev.left === left && prev.width === width ? prev : { left, width }));
    }}>
      {children}
      {ready ? <Frost opacity={frost} radius={radius} on={on} /> : null}
    </Animated.View>
  );
}
