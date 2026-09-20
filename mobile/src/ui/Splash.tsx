/**
 * The way in: the dial draws itself round, the hand sweeps to the hour behind
 * it, the pin lands and the name comes up underneath. Then the whole thing
 * lifts away and the app is already there.
 *
 * The native splash is a still of this same mark on this same navy, held up
 * until this layer has painted its first frame — so the two meet without a
 * white flash between them. It stays until the animation has run *and* the
 * keychain has answered, whichever is slower: a quick phone still sees all of
 * it, a slow one never sits through it twice.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Mask, Rect, Stop } from "react-native-svg";

import { nativeOrNull } from "@/ui/native";

const SIZE = 180;
const C = SIZE / 2;
const R = 49;
const RING_W = 6.5;
const PIN = 5.5;
const HAND_LEN = 28;
const HAND_W = 5;
const LAP = 2 * Math.PI * R;

// Where the hand stops, and how far round it comes to get there.
const REST = 32.5;
const SWEEP = 300;

const NAVY = "#121c2d";
const MINT = "#40e7a0";
const MINT_DEEP = "#24bd82";
const HAND = "#2ed092";

const INTRO_MS = 1150;

// The four gaps in the dial, at twelve, three, six and nine.
const GAPS = [
  { x: C - 2.1, y: 33, width: 4.2, height: 19 },
  { x: 128, y: C - 2.1, width: 19, height: 4.2 },
  { x: C - 2.1, y: 128, width: 4.2, height: 19 },
  { x: 33, y: C - 2.1, width: 19, height: 4.2 },
];

const Ring = Animated.createAnimatedComponent(Circle);

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const draw = useSharedValue(0);
  const pin = useSharedValue(0);
  const word = useSharedValue(0);
  const out = useSharedValue(0);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Let the still go once there is something of ours on the screen.
    const frame = requestAnimationFrame(() => {
      nativeOrNull(() => require("expo-splash-screen"))?.hideAsync?.()?.catch?.(() => {});
    });
    draw.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    pin.value = withDelay(260, withTiming(1, { duration: 320, easing: Easing.out(Easing.back(2)) }));
    word.value = withDelay(430, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }));
    const held = setTimeout(() => setShown(true), INTRO_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(held); };
  }, []);

  useEffect(() => {
    if (!shown || !ready) return;
    out.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [shown, ready]);

  const ring = useAnimatedProps(() => ({ strokeDashoffset: LAP * (1 - draw.value) }));
  const hand = useAnimatedStyle(() => ({ transform: [{ rotate: `${REST - SWEEP * (1 - draw.value)}deg` }] }));
  const pinned = useAnimatedStyle(() => ({ transform: [{ scale: pin.value }] }));
  const name = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 10 }] }));
  const layer = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  const mark = useAnimatedStyle(() => ({ transform: [{ scale: 1 + out.value * 0.08 }] }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.stage, layer]} testID="splash">
      <Animated.View style={[styles.mark, mark]}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            <LinearGradient id="splash-mark" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={MINT} />
              <Stop offset="1" stopColor={MINT_DEEP} />
            </LinearGradient>
            <Mask id="splash-ticks">
              <Rect width={SIZE} height={SIZE} fill="#fff" />
              {GAPS.map((g, i) => <Rect key={i} {...g} fill="#000" />)}
            </Mask>
          </Defs>
          <Ring
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke="url(#splash-mark)"
            strokeWidth={RING_W}
            strokeDasharray={LAP}
            animatedProps={ring}
            mask="url(#splash-ticks)"
            transform={`rotate(-90 ${C} ${C})`}
          />
        </Svg>

        {/* The hand turns about the pin: the box spins, the bar reaches out of its middle. */}
        <Animated.View style={[StyleSheet.absoluteFill, hand]} pointerEvents="none">
          <View style={styles.hand} />
        </Animated.View>
        <Animated.View style={[styles.pin, pinned]} pointerEvents="none" />
      </Animated.View>

      <Animated.View style={name}>
        <Text style={styles.name}>KaamKoRecord</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { backgroundColor: NAVY, alignItems: "center", justifyContent: "center", zIndex: 10 },
  mark: { width: SIZE, height: SIZE },
  hand: {
    position: "absolute",
    left: C,
    top: C - HAND_W / 2,
    width: HAND_LEN,
    height: HAND_W,
    borderRadius: HAND_W / 2,
    backgroundColor: HAND,
  },
  pin: {
    position: "absolute",
    left: C - PIN,
    top: C - PIN,
    width: PIN * 2,
    height: PIN * 2,
    borderRadius: PIN,
    backgroundColor: MINT,
  },
  name: { marginTop: 22, color: "#f1f3f8", fontSize: 26, fontWeight: "800", letterSpacing: -0.4 },
});
