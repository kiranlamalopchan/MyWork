/**
 * The way in, after the splash: four cards you swipe through, saying what
 * MyWork is for — the clock, the timesheet behind it, the PLU list, and the
 * one permission worth explaining before the phone asks for it.
 *
 * Everything here is driven by the scroll rather than by mounting: the art,
 * the words and the dots all read the same shared scroll position, so a card
 * half-dragged is half-arrived and a flick that changes its mind follows the
 * finger back. Nothing waits for a page to "land" before it starts.
 *
 * Colours, spacing, radii and the button are the app's own (ui/theme,
 * ui/index) — this screen introduces no look of its own.
 */
import React, { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { askForPush } from "@/push/register";
import { Button } from "@/ui";
import { tap, tick } from "@/ui/haptics";
import { alpha, mix, sp, useTheme, type Theme } from "@/ui/theme";

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Picked from the theme, so each card is one of the app's own accents. */
  tint: (t: Theme) => string;
  title: string;
  body: string;
  /** The last card asks for something rather than only saying something. */
  ask?: boolean;
};

const SLIDES: Slide[] = [
  {
    key: "clock",
    icon: "time",
    tint: (t) => t.brand,
    title: "Clock on, clock off",
    body: "Start a shift in one tap and take your breaks against it. Each job keeps its own hours cap, and the clock says how close you are to it before you press anything.",
  },
  {
    key: "sheet",
    icon: "calendar",
    tint: (t) => t.blue,
    title: "Every hour, added up",
    body: "This week written out a day at a time, the weeks behind it folded away, and what you are owed worked out from your rate — cash or taxed, job by job.",
  },
  {
    key: "plu",
    icon: "pricetag",
    tint: (t) => t.violet,
    title: "Any PLU, in seconds",
    body: "Search the whole list by number or by name. Or photograph a picking list and get every line on it named at once, then send it out as a PDF.",
  },
  {
    key: "push",
    icon: "notifications",
    tint: (t) => t.orange,
    title: "A nudge, not a nag",
    body: "So MyWork can remind you a shift is starting, tell you when you are near your hours cap, and pass on what goes up on the notice board.",
    ask: true,
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Slide>>(null);
  const [at, setAt] = useState(0);
  // The list's own height, measured rather than inherited: a card sizes to
  // its content otherwise, and a card that does not know the height it is in
  // cannot centre itself in it — it sits at the top with a hole beneath.
  const [tall, setTall] = useState(0);
  const [asking, setAsking] = useState(false);
  const x = useSharedValue(0);
  const asks = !!SLIDES[at]?.ask;

  // The page comes off the scroll position, not off onMomentumScrollEnd:
  // that event does not fire for a programmatic scroll on every platform, and
  // a Continue button that reads a stale page just scrolls to where you
  // already are. This follows a drag too, so the footer changes as the last
  // card arrives rather than after it has settled.
  const page = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    x.value = e.contentOffset.x;
    const now = Math.round(e.contentOffset.x / width);
    if (now !== page.value) { page.value = now; runOnJS(setAt)(now); }
  });

  const go = useCallback((to: number) => {
    list.current?.scrollToOffset({ offset: to * width, animated: true });
  }, [width]);

  const finish = useCallback(() => { tap("light"); onDone(); }, [onDone]);

  const allow = useCallback(async () => {
    setAsking(true);
    try {
      // The answer is the phone's business — we asked, and either way the
      // app opens. A no is not an error and is never mentioned again.
      await askForPush();
    } catch {
      /* no push on this build; the inbox still has everything */
    } finally {
      setAsking(false);
      onDone();
    }
  }, [onDone]);

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]} testID="onboarding">
      <View style={styles.top}>
        <Pressable onPress={finish} hitSlop={12} testID="onboarding-skip" accessibilityRole="button" style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ color: t.muted, fontSize: 15, fontWeight: "600" }}>Skip</Text>
        </Pressable>
      </View>

      <Animated.FlatList
        ref={list as never}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        // The list fills the room between the Skip row and the footer, and
        // `stretch` hands that height down to each card — a card sized to its
        // own content cannot centre itself in a space it does not know about,
        // and rides high with a hole beneath it.
        style={{ flex: 1 }}
        onLayout={(e) => setTall(e.nativeEvent.layout.height)}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => <Card slide={item} index={index} x={x} width={width} tall={tall} />}
      />

      <View style={[styles.foot, { paddingBottom: insets.bottom + sp[5] }]}>
        <Dots x={x} width={width} />
        {asks ? (
          <View style={{ gap: sp[2] }}>
            <Button title="Allow notifications" icon="notifications-outline" onPress={allow} busy={asking} testID="onboarding-allow" />
            <Button title="Not now" kind="plain" onPress={finish} />
          </View>
        ) : (
          <Button title="Continue" onPress={() => { tick(); go(at + 1); }} testID="onboarding-next" />
        )}
      </View>
    </View>
  );
}

/**
 * How far a card is from the middle of the screen, as a fraction of a page:
 * -1 is one page to the left, 0 is here, 1 is one page to the right.
 *
 * A worklet, and it has to be: the styles below are computed on the UI thread,
 * and a plain function called from there is a "remote function" the UI runtime
 * refuses to run. The web build never showed this — react-native-web runs
 * every worklet on the JS thread, where any function is callable.
 */
function near(v: number, index: number, width: number) {
  "worklet";
  return interpolate(
    v,
    [(index - 1) * width, index * width, (index + 1) * width],
    [-1, 0, 1],
    Extrapolation.CLAMP,
  );
}

/** One card: the art, the title, the words — all reading the scroll. */
function Card({ slide, index, x, width, tall }: { slide: Slide; index: number; x: SharedValue<number>; width: number; tall: number }) {
  const t = useTheme();
  const tint = slide.tint(t);

  const art = useAnimatedStyle(() => {
    const d = near(x.value, index, width);
    return {
      opacity: interpolate(Math.abs(d), [0, 1], [1, 0], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(Math.abs(d), [0, 1], [1, 0.78], Extrapolation.CLAMP) }, { translateX: d * -width * 0.18 }],
    };
  });
  // The words lag the art a little, which is what makes a card feel layered
  // rather than printed on one sheet of glass.
  const words = useAnimatedStyle(() => {
    const d = near(x.value, index, width);
    return {
      opacity: interpolate(Math.abs(d), [0, 0.75], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: Math.abs(d) * 26 }, { translateX: d * -width * 0.06 }],
    };
  });

  return (
    <View style={[styles.card, { width }, tall > 0 && { height: tall }]}>
      <Animated.View style={[styles.artWrap, art]}>
        <Art icon={slide.icon} tint={tint} />
      </Animated.View>
      <Animated.View style={[styles.words, words]}>
        <Text style={[styles.title, { color: t.text }]}>{slide.title}</Text>
        <Text style={[styles.body, { color: t.muted }]}>{slide.body}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * The illustration slot.
 *
 * A tonal disc in the card's own accent with the feature's icon on it, and
 * the same stray dots and arcs the holiday card's drawing uses, so the way in
 * looks like the app it is introducing. Swap the middle of this for an <Image>
 * or a Lottie when there is proper art — lottie-react-native is not installed
 * (it is a native module, so adding it means a rebuild), and everything around
 * it here is sized to be replaced.
 */
function Art({ icon, tint }: { icon: keyof typeof Ionicons.glyphMap; tint: string }) {
  const t = useTheme();
  return (
    <View style={styles.art}>
      <View style={[styles.blob, { backgroundColor: alpha(tint, 0.1) }]} />
      <View style={[styles.disc, { backgroundColor: mix(tint, t.surface, 0.16) }]}>
        <Ionicons name={icon} size={76} color={tint} />
      </View>
      <View style={[styles.dot, { top: 18, right: 34, backgroundColor: alpha(tint, 0.35) }]} />
      <View style={[styles.dot, styles.dotSm, { bottom: 30, left: 30, backgroundColor: alpha(tint, 0.3) }]} />
      <View style={[styles.arc, { borderTopColor: alpha(tint, 0.3) }]} />
    </View>
  );
}

/** The dots: the one you are on stretches into a bar as you swipe onto it. */
function Dots({ x, width }: { x: SharedValue<number>; width: number }) {
  return (
    <View style={styles.dots}>
      {SLIDES.map((s, i) => <Dot key={s.key} index={i} x={x} width={width} />)}
    </View>
  );
}

function Dot({ index, x, width }: { index: number; x: SharedValue<number>; width: number }) {
  const t = useTheme();
  const style = useAnimatedStyle(() => {
    const span = [(index - 1) * width, index * width, (index + 1) * width];
    return {
      width: interpolate(x.value, span, [8, 26, 8], Extrapolation.CLAMP),
      opacity: interpolate(x.value, span, [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.pip, { backgroundColor: t.brand }, style]} />;
}

const DISC = 176;

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: sp[5], height: 44 },
  skip: { paddingHorizontal: sp[3], paddingVertical: sp[2] },
  card: { alignItems: "center", justifyContent: "center", paddingHorizontal: sp[6], gap: sp[6] },
  artWrap: { alignItems: "center", justifyContent: "center" },
  art: { width: DISC + 80, height: DISC + 80, alignItems: "center", justifyContent: "center" },
  blob: { position: "absolute", width: DISC + 72, height: DISC + 72, borderRadius: (DISC + 72) / 2 },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", width: 14, height: 14, borderRadius: 7 },
  dotSm: { width: 9, height: 9, borderRadius: 4.5 },
  // A stroke of a circle, not a circle: only the top edge is painted.
  arc: { position: "absolute", top: 24, left: 16, width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: "transparent", transform: [{ rotate: "-35deg" }] },
  words: { alignItems: "center", gap: sp[3] },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -1, textAlign: "center", lineHeight: 35 },
  body: { fontSize: 15.5, lineHeight: 23, textAlign: "center", maxWidth: 360 },
  foot: { paddingHorizontal: sp[5], gap: sp[5] },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, height: 10 },
  pip: { height: 8, borderRadius: 4 },
});
