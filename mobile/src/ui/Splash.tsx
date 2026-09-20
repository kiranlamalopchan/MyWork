/**
 * The way in: the mark drops in from above and bounces to rest — three
 * bounces, each lower than the last, squashing on the floor and stretching
 * in the air, over a shadow that widens as it comes down. The name pops up
 * underneath once it has settled. Waiting on the keychain or the server,
 * the mark keeps a gentle bob so a wait never looks like a freeze; then the
 * whole thing lifts away and the app is already there.
 *
 * The native splash is a still of this same mark on this same navy, held up
 * until this layer has painted its first frame — so the two meet without a
 * white flash between them. It stays until the animation has run *and* the
 * keychain has answered, whichever is slower: a quick phone still sees all of
 * it, a slow one never sits through it twice.
 *
 * Every style here is computed on the UI thread from shared values and
 * arithmetic only — no helper is called from inside a worklet (see the
 * note on `near` in Onboarding.tsx for why the web build can't catch that).
 * The navy stays flat: the mark keeps its own two-stop gradient, the surface
 * behind it does not get one.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Rect, Stop } from "react-native-svg";

import { nativeOrNull } from "@/ui/native";

const SIZE = 150;
const C = SIZE / 2;
const R = 46;
const RING_W = 7;
const PIN = 5.5;
const HAND_LEN = 26;
const HAND_W = 5;
const REST = 32.5;

const NAVY = "#121c2d";
const MINT = "#40e7a0";
const MINT_DEEP = "#24bd82";
const INK = "#f1f3f8";
const MUTED = "#8a97ad";

const NAME = "KaamKoRecord";
const TAGLINE = "Clock in. Add it up.";

// The drop: from this far above the floor, then three bounces, each about
// 40% of the last, each half the time in the air.
const DROP = 260;
const BOUNCES = [
  { up: 105, ms: 300 },
  { up: 42, ms: 200 },
  { up: 14, ms: 125 },
];
const FALL_MS = 520;
const SETTLED_AT = FALL_MS + BOUNCES.reduce((sum, b) => sum + 2 * b.ms, 0); // 1770
const INTRO_MS = SETTLED_AT + 650;

// The four gaps in the dial, at twelve, three, six and nine.
const GAPS = [
  { x: C - 2.2, y: C - R - 6, width: 4.4, height: 19 },
  { x: C + R - 13, y: C - 2.2, width: 19, height: 4.4 },
  { x: C - 2.2, y: C + R - 13, width: 4.4, height: 19 },
  { x: C - R - 6, y: C - 2.2, width: 19, height: 4.4 },
];

const fallIn = Easing.in(Easing.quad);
const riseOut = Easing.out(Easing.quad);

export function Splash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const calm = useReducedMotion();
  const y = useSharedValue(calm ? 0 : -DROP); // the mark's height above the floor (negative = up)
  const squash = useSharedValue(0);           // 1 at the moment of impact
  const word = useSharedValue(0);             // the name and tagline
  const out = useSharedValue(0);              // the lift-away
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Let the still go once there is something of ours on the screen.
    const frame = requestAnimationFrame(() => {
      nativeOrNull(() => require("expo-splash-screen"))?.hideAsync?.()?.catch?.(() => {});
    });
    if (calm) {
      // Reduced motion: everything simply appears, and leaves by fading.
      word.value = 1;
    } else {
      // The fall and the bounces, one after another.
      y.value = withSequence(
        withTiming(0, { duration: FALL_MS, easing: fallIn }),
        ...BOUNCES.flatMap((b) => [
          withTiming(-b.up, { duration: b.ms, easing: riseOut }),
          withTiming(0, { duration: b.ms, easing: fallIn }),
        ]),
      );
      // A squash on each landing, hardest first, timed to the impacts above.
      let at = FALL_MS;
      const hits: number[] = [at];
      for (const b of BOUNCES) { at += 2 * b.ms; hits.push(at); }
      const strengths = [1, 0.6, 0.35, 0.18];
      let cursor = 0;
      const steps = hits.flatMap((hit, i) => {
        const inMs = 60, outMs = 200;
        const wait = Math.max(hit - 30 - cursor, 0);
        cursor = hit - 30 + inMs + outMs;
        return [
          withDelay(wait, withTiming(strengths[i], { duration: inMs, easing: Easing.out(Easing.quad) })),
          withTiming(0, { duration: outMs, easing: Easing.out(Easing.back(1.6)) }),
        ];
      });
      squash.value = withSequence(...steps);
      word.value = withDelay(SETTLED_AT - 80, withSpring(1, { damping: 12, stiffness: 170, mass: 0.7 }));
    }
    const held = setTimeout(() => setShown(true), calm ? 500 : INTRO_MS);
    return () => { cancelAnimationFrame(frame); clearTimeout(held); };
  }, [calm]);

  // Still here after the intro, waiting on the keychain or the server: a
  // small bob, over and over, until we go.
  useEffect(() => {
    if (!shown || ready || calm) return;
    y.value = withRepeat(
      withSequence(withTiming(-12, { duration: 380, easing: riseOut }), withTiming(0, { duration: 380, easing: fallIn })),
      -1,
      false,
    );
    return () => cancelAnimation(y);
  }, [shown, ready, calm]);

  useEffect(() => {
    if (!shown || !ready) return;
    cancelAnimation(y);
    y.value = withTiming(0, { duration: 160, easing: fallIn });
    out.value = withTiming(1, { duration: calm ? 300 : 460, easing: Easing.inOut(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [shown, ready]);

  // The mark: up and down with `y`; flattened on impact, drawn out a little
  // while it is high in the air.
  const mark = useAnimatedStyle(() => {
    const air = interpolate(-y.value, [0, DROP], [0, 1], Extrapolation.CLAMP);
    const sx = 1 + 0.32 * squash.value - 0.05 * air;
    const sy = 1 - 0.28 * squash.value + 0.07 * air;
    return { transform: [{ translateY: y.value }, { scaleX: sx * (1 + out.value * 0.1) }, { scaleY: sy * (1 + out.value * 0.1) }] };
  });
  // The shadow: wide and dark when the mark is on the floor, a faint far
  // speck when it is high.
  const shadow = useAnimatedStyle(() => {
    const air = interpolate(-y.value, [0, DROP], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: (0.38 - 0.3 * air) * (1 - out.value),
      transform: [{ scaleX: 0.55 + 0.45 * (1 - air) + 0.25 * squash.value }, { scaleY: 0.8 + 0.2 * (1 - air) }],
    };
  });
  const words = useAnimatedStyle(() => ({
    opacity: interpolate(word.value, [0, 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: (1 - word.value) * 22 - out.value * 16 }, { scale: 0.85 + 0.15 * word.value }],
  }));
  const tag = useAnimatedStyle(() => ({ opacity: interpolate(word.value, [0.5, 1], [0, 1], Extrapolation.CLAMP) }));
  const layer = useAnimatedStyle(() => ({ opacity: 1 - out.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.stage, layer]} testID="splash">
      <View style={styles.well}>
        <Animated.View style={[styles.shadow, shadow]} pointerEvents="none" />
        <Animated.View style={[styles.mark, mark]}>
          <Mark />
        </Animated.View>
      </View>

      <Animated.View style={[styles.words, words]}>
        <Animated.Text style={styles.name}>{NAME}</Animated.Text>
        <Animated.Text style={[styles.tagline, tag]}>{TAGLINE}</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

/** The dial, the hand and the pin, drawn — the same mark as the icon. */
function Mark() {
  const hx = C + Math.cos((REST * Math.PI) / 180) * HAND_LEN;
  const hy = C + Math.sin((REST * Math.PI) / 180) * HAND_LEN;
  return (
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
      <Circle cx={C} cy={C} r={R} fill="none" stroke="url(#splash-mark)" strokeWidth={RING_W} mask="url(#splash-ticks)" />
      <Path d={`M${C} ${C}L${hx} ${hy}`} stroke="url(#splash-mark)" strokeWidth={HAND_W} strokeLinecap="round" />
      <Circle cx={C} cy={C} r={PIN} fill="url(#splash-mark)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: { backgroundColor: NAVY, alignItems: "center", justifyContent: "center", zIndex: 10 },
  // Room for the drop above and the shadow below, so nothing is clipped.
  well: { width: SIZE + 40, height: SIZE + 40, alignItems: "center", justifyContent: "flex-end" },
  mark: { width: SIZE, height: SIZE, marginBottom: 14 },
  shadow: {
    position: "absolute",
    bottom: 0,
    width: SIZE * 0.78,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#000",
  },
  words: { alignItems: "center", marginTop: 26 },
  name: { color: INK, fontSize: 27, fontWeight: "800", letterSpacing: -0.4 },
  tagline: { color: MUTED, fontSize: 14, fontWeight: "600", letterSpacing: 0.2, marginTop: 8 },
});

