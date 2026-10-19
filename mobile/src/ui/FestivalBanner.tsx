import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Image, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Festival } from "@/api/types";
import { Card } from "./index";
import { DashainMotion } from "./DashainMotion";
import { useTheme } from "./theme";
const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  lights: "flame", snow: "ellipse", fireworks: "sparkles", butterflies: "flower",
  colour: "ellipse", flags: "flag", sun: "sunny", petals: "flower", bell: "notifications",
  water: "water", feather: "leaf", lantern: "bulb", confetti: "sparkles",
};
export function FestivalBanner({ festival }: { festival: Festival }) {
  const t = useTheme(), progress = useRef(new Animated.Value(0)).current;
  const dashain = festival.id === "dashain" || festival.motion === "kites";
  const { width } = useWindowDimensions();
  const narrow = width < 560;
  const [reduced, setReduced] = useState(true), [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const state = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; reduce.remove(); state.remove(); };
  }, []);
  useEffect(() => {
    if (dashain || reduced || !active || !icons[festival.motion]) return;
    progress.setValue(0);
    const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 4500, useNativeDriver: true }));
    animation.start(); return () => animation.stop();
  }, [progress, reduced, active, festival.motion, dashain]);
  return <Card pad={false} style={{ overflow: "hidden", borderRadius: narrow ? 16 : 20 }}>
    <View style={{ height: narrow ? 104 : 260, overflow: "hidden", backgroundColor: "#153c39" }}>
      <Image source={{ uri: festival.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      {dashain ? <DashainMotion animate={!reduced && active} compact={narrow} /> : null}
      {!dashain && !reduced && icons[festival.motion] ? <View pointerEvents="none" accessibilityElementsHidden style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: festival.motion === "sun" || festival.motion === "bell" ? 1 : 7 }, (_, index) => <Animated.View key={index} style={{ position: "absolute", left: `${8 + index * 13}%`, top: 25 + index % 3 * 35, opacity: progress.interpolate({ inputRange: [0, .5, 1], outputRange: [.35, 1, .35] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [15, -20] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "15deg"] }) }] }}>
          <Ionicons name={icons[festival.motion]} size={festival.motion === "snow" ? 8 : festival.motion === "sun" ? 48 : 22} color={festival.motion === "snow" ? "white" : index % 2 ? t.brand : t.warn} />
        </Animated.View>)}
      </View> : null}
      <View style={{ position: "absolute", top: narrow ? 14 : 60, left: narrow ? 16 : 32, maxWidth: "58%", gap: narrow ? 5 : 6 }}>
        {/* No shade over the picture (flat, no gradients): the words carry their own shadow instead. */}
        <Text style={{ color: "#fff", fontSize: narrow ? 9 : 10, fontWeight: "700", letterSpacing: 1.6, textShadowColor: "rgba(0,0,0,0.55)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } }}>CELEBRATING TOGETHER</Text>
        <Text style={{ color: "#fff", fontSize: narrow ? 24 : 40, lineHeight: narrow ? 26 : 44, fontWeight: "800", letterSpacing: -0.8, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } }}>{festival.greeting}</Text>
      </View>
    </View>
    <View style={{ paddingHorizontal: narrow ? 14 : 24, paddingTop: narrow ? 8 : 18, paddingBottom: narrow ? 10 : 22, gap: narrow ? 4 : 5 }}>
      <Text style={{ color: t.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 }}>ABOUT {festival.name.toUpperCase()}</Text>
      <Text style={{ color: t.text2, fontSize: narrow ? 12 : 14, lineHeight: narrow ? 18 : 23 }}>{festival.description}</Text>
    </View>
  </Card>;
}
