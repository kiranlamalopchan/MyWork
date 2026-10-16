import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Image, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Festival } from "@/api/types";
import { Card } from "./index";
import { sp, useTheme } from "./theme";
const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  kites: "diamond", lights: "flame", snow: "ellipse", fireworks: "sparkles", butterflies: "flower",
  colour: "ellipse", flags: "flag", sun: "sunny", petals: "flower", bell: "notifications",
  water: "water", feather: "leaf", lantern: "bulb", confetti: "sparkles",
};
export function FestivalBanner({ festival }: { festival: Festival }) {
  const t = useTheme(), progress = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(true), [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const state = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; reduce.remove(); state.remove(); };
  }, []);
  useEffect(() => {
    if (reduced || !active || !icons[festival.motion]) return;
    progress.setValue(0);
    const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 4500, useNativeDriver: true }));
    animation.start(); return () => animation.stop();
  }, [progress, reduced, active, festival.motion]);
  return <Card pad={false} style={{ overflow: "hidden" }}>
    <View style={{ height: 175, overflow: "hidden" }}>
      <Image source={{ uri: festival.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      {!reduced && icons[festival.motion] ? <View pointerEvents="none" accessibilityElementsHidden style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: festival.motion === "sun" || festival.motion === "bell" ? 1 : 7 }, (_, index) => <Animated.View key={index} style={{ position: "absolute", left: `${8 + index * 13}%`, top: 25 + index % 3 * 35, opacity: progress.interpolate({ inputRange: [0, .5, 1], outputRange: [.35, 1, .35] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [15, -20] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "15deg"] }) }] }}>
          <Ionicons name={icons[festival.motion]} size={festival.motion === "snow" ? 8 : festival.motion === "sun" ? 48 : 22} color={festival.motion === "snow" ? "white" : index % 2 ? t.brand : t.warn} />
        </Animated.View>)}
      </View> : null}
    </View>
    <View style={{ padding: sp[4], gap: sp[2] }}><Text style={{ color: t.text, fontSize: 22, fontWeight: "700" }}>{festival.greeting}</Text><Text style={{ color: t.muted, lineHeight: 20 }}>{festival.description}</Text></View>
  </Card>;
}
