import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, AppState, Image, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import type { Festival } from "@/api/types";
import { Card } from "./index";
import { DashainMotion } from "./DashainMotion";
import { sp, useTheme } from "./theme";
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
  const shade = `festival-shade-${React.useId()}`;
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
    <View style={{ height: narrow ? 135 : 260, overflow: "hidden", backgroundColor: "#153c39" }}>
      <Image source={{ uri: festival.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs><LinearGradient id={shade} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#000" stopOpacity={0.45} /><Stop offset="0.75" stopColor="#000" stopOpacity={0} /></LinearGradient></Defs>
        <Rect width="100%" height="100%" fill={`url(#${shade})`} />
      </Svg>
      {dashain ? <DashainMotion animate={!reduced && active} /> : null}
      {!dashain && !reduced && icons[festival.motion] ? <View pointerEvents="none" accessibilityElementsHidden style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: festival.motion === "sun" || festival.motion === "bell" ? 1 : 7 }, (_, index) => <Animated.View key={index} style={{ position: "absolute", left: `${8 + index * 13}%`, top: 25 + index % 3 * 35, opacity: progress.interpolate({ inputRange: [0, .5, 1], outputRange: [.35, 1, .35] }), transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [15, -20] }) }, { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["-10deg", "15deg"] }) }] }}>
          <Ionicons name={icons[festival.motion]} size={festival.motion === "snow" ? 8 : festival.motion === "sun" ? 48 : 22} color={festival.motion === "snow" ? "white" : index % 2 ? t.brand : t.warn} />
        </Animated.View>)}
      </View> : null}
      <View style={{ position: "absolute", top: narrow ? 18 : 60, left: narrow ? 18 : 32, maxWidth: "58%", gap: 6 }}>
        <Text style={{ color: "#fff", fontSize: narrow ? 9 : 10, fontWeight: "700", letterSpacing: 1.6 }}>CELEBRATING TOGETHER</Text>
        <Text style={{ color: "#fff", fontSize: narrow ? 26 : 40, lineHeight: narrow ? 29 : 44, fontWeight: "800", letterSpacing: -0.8, textShadowColor: "rgba(0,0,0,0.15)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } }}>{festival.greeting}</Text>
      </View>
    </View>
    <View style={{ paddingHorizontal: narrow ? sp[4] : 24, paddingTop: narrow ? 12 : 18, paddingBottom: narrow ? 14 : 22, gap: 5 }}>
      <Text style={{ color: t.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1.2 }}>ABOUT {festival.name.toUpperCase()}</Text>
      <Text style={{ color: t.text2, fontSize: narrow ? 13 : 14, lineHeight: narrow ? 20 : 23 }}>{festival.description}</Text>
    </View>
  </Card>;
}
