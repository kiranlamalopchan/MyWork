/** Shared brand/back header. Main destinations live in the native tab bar. */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Rect, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

import { goBack } from "@/nav/paths";

import { setChromeHidden, useChromeHidden } from "./chrome";
import { useLayout } from "./layout";
import { useTheme } from "./theme";


/**
 * The brand mark: the app's own icon, the clock on its navy tile. Drawn
 * rather than loaded so it is sharp at any size, and its gradient stops get
 * ids of their own, so two marks on one screen never share a paint.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const id = React.useId();
  const plate = `bm-plate-${id}`;
  const mark = `bm-mark-${id}`;
  const ticks = `bm-ticks-${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id={plate} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1a2740" />
          <Stop offset="1" stopColor="#0b111a" />
        </LinearGradient>
        <LinearGradient id={mark} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#40e7a0" />
          <Stop offset="1" stopColor="#24bd82" />
        </LinearGradient>
        <Mask id={ticks}>
          <Rect width={512} height={512} fill="#fff" />
          <Rect x={250} y={94} width={12} height={54} fill="#000" />
          <Rect x={364} y={250} width={54} height={12} fill="#000" />
          <Rect x={250} y={364} width={12} height={54} fill="#000" />
          <Rect x={94} y={250} width={54} height={12} fill="#000" />
        </Mask>
      </Defs>
      <Rect width={512} height={512} rx={102} fill={`url(#${plate})`} />
      <Circle cx={256} cy={256} r={138} fill="none" stroke={`url(#${mark})`} strokeWidth={18} mask={`url(#${ticks})`} />
      <Path d="M256 256l66 42" stroke={`url(#${mark})`} strokeWidth={14} strokeLinecap="round" />
      <Circle cx={256} cy={256} r={15} fill={`url(#${mark})`} />
    </Svg>
  );
}

export function AppBar({ title, back, backLabel, section, right }: {
  title?: string; back?: boolean; backLabel?: string; section?: string; right?: React.ReactNode; tools?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const router = useRouter();
  // The bar floats over the page, clear: the page scrolls up under it and
  // shows through, only dimmed by a fade. On the way down a long page it
  // slides up out of the way, leaving only the fade behind the status bar,
  // so the page has the whole screen; it comes home only when the page is
  // scrolled back up to its top (ui/chrome.ts). It moves on the native driver — a transform and an
  // opacity, nothing laid out again — so it never holds a scroll up. Every
  // page opens with the bar showing.
  const hidden = useChromeHidden();
  const away = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(away, { toValue: hidden ? 1 : 0, useNativeDriver: true, stiffness: 320, damping: 34, mass: 1, overshootClamping: true }).start();
  }, [hidden, away]);
  useFocusEffect(React.useCallback(() => { setChromeHidden(false); }, []));
  const slide = away.interpolate({ inputRange: [0, 1], outputRange: [0, -layout.bar] });
  const shown = away.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: "clamp" });

  // Where the back button ends and the tools begin, so the title can be
  // centred on the screen without running into either (see titleSpot).
  const [row, setRow] = useState({ width: 0, backEnd: 0, toolsAt: 0 });
  const measure = (part: Partial<typeof row>) => setRow((was) => {
    const next = { ...was, ...part };
    return next.width === was.width && next.backEnd === was.backEnd && next.toolsAt === was.toolsAt ? was : next;
  });

  const body = (
    // On an iPad the bar spans the hub's width, whatever the page under it is doing.
    <View style={[styles.inner, layout.desk ? layout.hub : layout.column, { height: layout.bar }]} onLayout={(e) => measure({ width: e.nativeEvent.layout.width })}>
      {back ? (
        <Pressable onPress={goBack} hitSlop={8} accessibilityLabel="Back" testID="appbar-back"
          onLayout={(e) => measure({ backEnd: e.nativeEvent.layout.x + e.nativeEvent.layout.width })}
          style={({ pressed }) => [styles.back, { backgroundColor: pressed ? t.surface3 : t.dark ? t.surface2 : t.surface }, tool(t.dark)]}>
          <Ionicons name="chevron-back" size={22} color={t.text} />
          {backLabel ? <Text style={{ color: t.text, fontSize: 15, fontWeight: "600", marginRight: 4 }} numberOfLines={1}>{backLabel}</Text> : null}
        </Pressable>
      ) : (
        <Pressable onPress={() => router.navigate("/")} style={styles.brand} accessibilityLabel="KaamKoRecord, home">
          <BrandMark size={34} />
          <Text style={[styles.brandText, { color: t.text }]}>KaamKoRecord</Text>
          {section ? <Text style={[styles.section, { backgroundColor: t.brandSoft, color: t.brand }]}>{section}</Text> : null}
        </Pressable>
      )}
      {back && title ? (
        <Text style={[titleSpot(row), { color: t.text }]} numberOfLines={1} pointerEvents="none" testID="appbar-title">{title}</Text>
      ) : null}
      <View style={styles.tools} onLayout={(e) => measure({ toolsAt: e.nativeEvent.layout.x })}>
        {right}

      </View>
    </View>
  );

  const height = insets.top + layout.bar;
  return (
    <Animated.View pointerEvents="box-none" style={[styles.bar, { height: height + FADE, transform: [{ translateY: slide }] }]}>
      <Glass top={insets.top} height={height} />
      {/* Taps on the bar's empty space stay on the bar; the fade below lets them through to the page. */}
      <View style={[styles.catch, { height }]} />
      <Animated.View pointerEvents={hidden ? "none" : "box-none"} style={{ paddingTop: insets.top, opacity: shown }}>{body}</Animated.View>
    </Animated.View>
  );
}

/** The least room a centred title is given before it moves in beside the back button instead. */
const TITLE_MIN = 96;
const TITLE_GAP = 8;

/**
 * Where the title goes. Centred on the bar, the way a system nav bar's is,
 * but kept clear of both sides by the wider of the two — the back button
 * (whose label can be long) and the page's tools — so it truncates rather
 * than running under either. Where that leaves too little room, or before
 * the row has been measured, it sits in the row between them instead,
 * which can never overlap.
 */
export function titleSpot({ width, backEnd, toolsAt }: { width: number; backEnd: number; toolsAt: number }) {
  if (!width || !backEnd || !toolsAt) return styles.titleFlow;
  const side = Math.max(backEnd, width - toolsAt) + TITLE_GAP;
  if (width - side * 2 < TITLE_MIN) return styles.titleFlow;
  return [styles.title, { left: side, right: side }];
}

/** How far past the bar its fade reaches down over the page. */
const FADE = 22;

/**
 * Behind the bar: no frosted sheet, just the page's own colour fading out —
 * the way iOS 26 lets a page run clear up under its navigation bar. It is
 * densest behind the status bar, so the clock and battery stay readable,
 * thins through the bar and is gone a little below it. One continuous
 * gradient, so there is no edge or step anywhere to show as a line.
 */
function Glass({ top, height }: { top: number; height: number }) {
  const t = useTheme();
  const id = `fade-${React.useId()}`;
  const total = height + FADE;
  const at = (y: number) => Math.min(1, Math.max(0, y / total));
  return (
    <Svg pointerEvents="none" width="100%" height={total} style={styles.glass}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={t.bg} stopOpacity={0.9} />
          <Stop offset={at(top)} stopColor={t.bg} stopOpacity={0.78} />
          <Stop offset={at(top + (height - top) * 0.5)} stopColor={t.bg} stopOpacity={0.5} />
          <Stop offset={at(height)} stopColor={t.bg} stopOpacity={0.22} />
          <Stop offset={at(height + FADE * 0.5)} stopColor={t.bg} stopOpacity={0.06} />
          <Stop offset={1} stopColor={t.bg} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height={total} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The round tool buttons' shadow — a lift in the light, nothing in the dark. */
export const tool = (dark: boolean) =>
  Platform.OS === "android" ? { elevation: dark ? 0 : 1 } : dark ? {} : { shadowColor: "#1a2540", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } };

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 40, overflow: "hidden" },
  catch: { position: "absolute", top: 0, left: 0, right: 0 },
  glass: { position: "absolute", top: 0, left: 0, right: 0 },
  inner: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 9, marginRight: "auto", flexShrink: 1 },
  brandText: { fontSize: 19, fontWeight: "800", letterSpacing: -0.5 },
  section: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  back: { flexDirection: "row", alignItems: "center", height: 40, minWidth: 40, marginRight: "auto", paddingLeft: 7, paddingRight: 9, borderRadius: 20 },
  title: { position: "absolute", textAlign: "center", fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  titleFlow: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  tools: { flexDirection: "row", alignItems: "center", gap: 8 },
});
