import React, { useCallback, useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { EdgeItem, useRailScroll } from "./Frost";
import { tick } from "./haptics";
import { radius, sp, useTheme } from "./theme";
import { useReducedMotion } from "./useReducedMotion";

export type RailOption<T> = { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap; dot?: string };

/**
 * Single-choice tabs/chips: one swipeable row, keeping the selection in view.
 * Chips get the Pay wallet's edge effect (see Frost.tsx): one cut by the
 * row's edge is smaller and frosted until it is slid in. `bleed` (the page
 * gutter) lets a row at the page's edge run on to the screen's edge.
 */
export function ChoiceRail<T extends string | number>({ value, onChange, options, label = "Options", variant = "chips", style, animated = true, bleed = 0 }: {
  value: T | ""; onChange: (value: T) => void; options: RailOption<T>[]; label?: string; variant?: "chips" | "segments"; style?: ViewStyle; animated?: boolean; bleed?: number;
}) {
  const t = useTheme(), reduced = useReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const sizes = useRef(new Map<T, { x: number; width: number }>());
  const viewport = useRef(0), offset = useRef(0);
  const segmented = variant === "segments";
  const rail = useRailScroll(event => { offset.current = event.nativeEvent.contentOffset.x; });
  const [stops, setStops] = React.useState<number[]>([]);
  const measured = (option: T, box: { x: number; width: number }) => {
    sizes.current.set(option, box);
    if (option === value) reveal();
    const next = [...sizes.current.values()].map(b => Math.max(0, b.x - bleed)).sort((a, b) => a - b);
    setStops(prev => prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next);
  };
  const reveal = useCallback(() => {
    const item = sizes.current.get(value as T), width = viewport.current;
    if (!item || !width) return;
    const next = item.x < offset.current ? item.x : item.x + item.width > offset.current + width ? item.x + item.width - width : offset.current;
    if (next !== offset.current) scroll.current?.scrollTo({ x: Math.max(0, next), animated: animated && !reduced });
  }, [value, reduced, animated]);
  useEffect(reveal, [reveal, options.length]);
  const chip = (option: RailOption<T>) => {
    const selected = option.value === value;
    const ink = selected ? segmented ? t.text : t.brandInk : t.muted;
    return <Pressable key={String(option.value)} accessibilityRole={segmented ? "tab" : "radio"}
      accessibilityState={segmented ? { selected } : { checked: selected }}
      onLayout={segmented ? event => { sizes.current.set(option.value, event.nativeEvent.layout); if (selected) reveal(); } : undefined}
      onPress={() => { if (!selected) { tick(); onChange(option.value); } }}
      style={[styles.option, segmented ? styles.segment : styles.chip,
        { backgroundColor: selected ? segmented ? t.dark ? t.surface3 : t.knob : t.brand : segmented ? "transparent" : t.surface2 }]}>
      {option.icon ? <Ionicons name={option.icon} size={17} color={ink} /> : null}
      {option.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selected ? ink : option.dot }} /> : null}
      <Text style={{ color: ink, fontSize: segmented ? 14 : 15, fontWeight: "700" }}>{option.label}</Text>
    </Pressable>;
  };
  return <Animated.ScrollView ref={scroll} horizontal directionalLockEnabled nestedScrollEnabled showsHorizontalScrollIndicator={false}
    accessibilityRole={segmented ? "tablist" : "radiogroup"} accessibilityLabel={label}
    testID={`choice-rail-${label}`} style={[styles.scroll, segmented && { backgroundColor: t.dark ? t.surface2 : t.track, borderRadius: radius.sm + 2 }, bleed ? { marginHorizontal: -bleed } : null, style]}
    contentContainerStyle={[styles.row, segmented && styles.track, bleed ? { paddingHorizontal: bleed } : null]}
    snapToOffsets={segmented || stops.length < 2 ? undefined : stops} decelerationRate={segmented ? "normal" : "fast"}
    onLayout={event => { viewport.current = event.nativeEvent.layout.width; rail.setViewport(event.nativeEvent.layout.width); reveal(); }}
    onScroll={rail.onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled">
    {options.map(option => segmented ? chip(option) : (
      <EdgeItem key={String(option.value)} x={rail.x} viewport={rail.viewport} radius={radius.pill} shrink={0.92} onMeasure={box => measured(option.value, box)}>
        {chip(option)}
      </EdgeItem>
    ))}
  </Animated.ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "stretch", gap: sp[2], paddingVertical: 2 },
  track: { flexGrow: 1, gap: 2, padding: 3 },
  option: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: sp[3], flexShrink: 0 },
  segment: { flexGrow: 1, borderRadius: radius.sm },
  chip: { borderRadius: radius.pill },
});
