import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

/** Native Dashain artwork, matching the kites and ping on the website. */
export function DashainMotion({ animate, compact = false }: { animate: boolean; compact?: boolean }) {
  const red = useRef(new Animated.Value(0)).current;
  const gold = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const values = [red, gold, swing];
    values.forEach(value => value.setValue(0));
    if (!animate) return;
    const animations = values.map((value, index) => {
      const duration = [5500, 7000, 1800][index];
      const step = (toValue: number) => Animated.timing(value, {
        toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
      });
      return Animated.loop(Animated.sequence([step(1), step(0)]));
    });
    animations.forEach(animation => animation.start());
    return () => animations.forEach(animation => animation.stop());
  }, [animate, red, gold, swing]);

  const kiteTransform = (value: Animated.Value, reverse = false) => [
    { translateX: value.interpolate({ inputRange: [0, 1], outputRange: reverse ? [5, -5] : [-4, 7] }) },
    { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [4, -6] }) },
    { rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["-7deg", "8deg"] }) },
  ];

  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} testID="dashain-scene">
    <Animated.View style={{ position: "absolute", left: "55%", top: compact ? 1 : 20, width: compact ? 44 : 46, height: compact ? 105 : 108, transform: kiteTransform(red) }} testID="dashain-red-kite">
      <Svg width="100%" height="100%" viewBox="-40 -45 80 225">
        <Path d="M0 -31 26 0 0 34 -26 0Z" fill="#e9392b" stroke="#742718" strokeWidth={1.6} />
        <Path d="M0 -31V34M-26 0H26" stroke="#f8c772" strokeWidth={1} />
        <Path d="M0 34Q-24 56 0 69T-3 99" fill="none" stroke="#e9392b" strokeWidth={3} />
        <Path d="M0 34Q35 108 -5 162" fill="none" stroke="#241a15" strokeWidth={1} />
      </Svg>
    </Animated.View>
    <Animated.View style={{ position: "absolute", left: "68%", top: compact ? 0 : 6, width: compact ? 34 : 36, height: compact ? 95 : 100, transform: kiteTransform(gold, true) }} testID="dashain-gold-kite">
      <Svg width="100%" height="100%" viewBox="-32 -35 64 205">
        <Path d="M0 -24 21 0 0 28 -21 0Z" fill="#ffda45" stroke="#ae5619" strokeWidth={1.4} />
        <Path d="M0 -24V28M-21 0H21" stroke="#c87328" />
        <Path d="M0 28Q-16 49 0 61T2 83" fill="none" stroke="#f5ba28" strokeWidth={2.5} />
        <Path d="M0 28Q25 100 4 165" fill="none" stroke="#241a15" strokeWidth={0.8} />
      </Svg>
    </Animated.View>
    <View style={{ position: "absolute", right: "2%", top: compact ? 8 : 16, width: 100, height: 145, transformOrigin: "100% 0%", transform: [{ scale: compact ? 0.6 : 0.78 }] }} testID="dashain-swing">
      <Svg width="100%" height="100%" viewBox="0 0 100 145">
        <Path d="M50 8 12 140M50 8 92 140M40 7H61" fill="none" stroke="#211911" strokeWidth={5} strokeLinecap="round" />
        <Path d="M39 20H62" stroke="#211911" strokeWidth={3} strokeLinecap="round" />
      </Svg>
      <Animated.View style={{ position: "absolute", left: 15, top: 13, width: 70, height: 115, transformOrigin: "50% 0%", transform: [{ rotate: swing.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "12deg"] }) }] }}>
        <Svg width="100%" height="100%" viewBox="0 0 70 115">
          <Path d="M31 0 21 98M39 0 53 98" fill="none" stroke="#211911" strokeWidth={1.5} />
          <Path d="M19 99H55" stroke="#211911" strokeWidth={4} strokeLinecap="round" />
          <Circle cx={36} cy={71} r={5} fill="#211911" />
          <Path d="M35 78V93L46 98 57 94M35 86 25 80 22 68" fill="none" stroke="#211911" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  </View>;
}
