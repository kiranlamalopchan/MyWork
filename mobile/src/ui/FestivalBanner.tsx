import React, { useEffect, useId, useState } from "react";
import { AccessibilityInfo, AppState, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Festival } from "@/api/types";
import { Card } from "./index";
import { DashainMotion } from "./DashainMotion";
import { FestivalScene } from "./FestivalScene";
import { useTheme } from "./theme";

export function FestivalBanner({ festival }: { festival: Festival }) {
  const t = useTheme(), gradient = `festival-shade-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const compact = useWindowDimensions().width < 560;
  const dashain = festival.id === "dashain" || festival.motion === "kites";
  const [reduced, setReduced] = useState(true), [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); }).catch(() => {});
    const reduce = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    const state = AppState.addEventListener("change", value => setActive(value === "active"));
    return () => { alive = false; reduce.remove(); state.remove(); };
  }, []);
  const animate = !reduced && active;
  return <Card pad={false} style={{ overflow: "hidden", borderRadius: compact ? 18 : 24 }}>
    <View testID="festival-artwork" style={{ minHeight: compact ? 104 : 260, overflow: "hidden", backgroundColor: "#17362f", justifyContent: "center" }}>
      <Image source={{ uri: festival.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={gradient} x1={0} y1={0} x2={1} y2={0}>
              <Stop offset={0} stopColor="#101c28" stopOpacity={0.72} />
              <Stop offset={0.65} stopColor="#101c28" stopOpacity={0.58} />
              <Stop offset={1} stopColor="#101c28" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gradient})`} />
        </Svg>
      </View>
      {dashain ? <DashainMotion animate={animate} compact={compact} /> : null}
      <FestivalScene id={festival.id} motion={festival.motion} animate={animate} compact={compact} />
      <View style={{ paddingVertical: compact ? 13 : 36, paddingLeft: compact ? 16 : 32, width: "60%", gap: compact ? 5 : 10 }}>
        <Text style={{ color: "#ffe6b1", fontSize: compact ? 9 : 10, fontWeight: "700", letterSpacing: 1.6 }}>SEASON OF TOGETHERNESS</Text>
        <Text accessibilityRole="header" style={{ color: "#fffaf0", fontSize: compact ? festival.greeting.length > 28 ? 19 : 24 : 40, lineHeight: compact ? festival.greeting.length > 28 ? 23 : 27 : 46, fontWeight: "700", letterSpacing: -.7, textShadowColor: "rgba(0,0,0,.3)", textShadowRadius: 8, textShadowOffset: { width: 0, height: 1 } }}>{festival.greeting}</Text>
      </View>
    </View>
    <View style={{ paddingHorizontal: compact ? 16 : 24, paddingVertical: compact ? 12 : 20, gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <View style={{ width: 4, height: 12, borderRadius: 2, backgroundColor: t.brand }} />
        <Text style={{ flex: 1, color: t.muted, fontSize: 10, fontWeight: "600", letterSpacing: 1.2 }}>THE SPIRIT OF {festival.name.toUpperCase()}</Text>
      </View>
      <Text style={{ color: t.text2, fontSize: compact ? 12 : 14, lineHeight: compact ? 18 : 23 }}>{festival.description}</Text>
    </View>
  </Card>;
}
