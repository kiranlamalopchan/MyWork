/**
 * The way in, after the splash: four screens you swipe through, saying what
 * KaamKoRecord is for — the clock, the timesheet behind it, the PLU list, and
 * the one permission worth explaining before the phone asks for it.
 *
 * The shape is the one most onboarding tours share: the upper half is a
 * coloured stage with the screen's picture on it, and a white sheet with
 * big rounded corners rises from the bottom holding the words, the dots,
 * Skip and Next. The stage's colour is each screen's own accent, and it
 * blends from one to the next as you swipe — nothing waits for a page to
 * "land" before it starts, because everything reads the same scroll
 * position: the picture, the words, the dots, the colour.
 *
 * Colours, spacing, radii and the buttons are the app's own (ui/theme,
 * ui/index) — this screen introduces no look of its own, and every
 * surface stays a solid colour.
 */
import React, { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { askForPush } from "@/push/register";
import { Button } from "@/ui";
import { tap, tick } from "@/ui/haptics";
import { alpha, mix, radius, sp, useTheme, type Theme } from "@/ui/theme";

type Slide = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Picked from the theme, so each screen is one of the app's own accents. */
  tint: (t: Theme) => string;
  title: string;
  body: string;
  /** The last screen asks for something rather than only saying something. */
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
    body: "So KaamKoRecord can tell you when you are still clocked in, warn you near your hours cap, and pass on what goes up on the notice board.",
    ask: true,
  },
];

// The sheet's corner, and the height of the words in it — fixed, so the
// sheet behind the list can be drawn to the same line.
const SHEET_RADIUS = 34;
const WORDS_H = 176;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const list = useRef<FlatList<Slide>>(null);
  const [at, setAt] = useState(0);
  // The list's own height, measured rather than inherited: a card sizes to
  // its content otherwise, and the stage cannot fill what it does not know.
  const [tall, setTall] = useState(0);
  const [asking, setAsking] = useState(false);
  const x = useSharedValue(0);
  const asks = !!SLIDES[at]?.ask;
  const last = at === SLIDES.length - 1;

  // The page comes off the scroll position, not off onMomentumScrollEnd:
  // that event does not fire for a programmatic scroll on every platform, and
  // a Next button that reads a stale page just scrolls to where you already
  // are. This follows a drag too, so the footer changes as the last card
  // arrives rather than after it has settled.
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

  // The stage: each screen's accent, softened into the surface, blending
  // from one to the next with the swipe.
  const stages = SLIDES.map((s) => mix(s.tint(t), t.surface, t.dark ? 0.22 : 0.18));
  const stops = SLIDES.map((_, i) => i * width);
  const stage = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(x.value, stops, stages) }));

  return (
    <Animated.View style={[styles.root, stage]} testID="onboarding">
      {/* The sheet behind the lower part of the list: the words ride on it,
          the footer sits in it. */}
      <View pointerEvents="none" style={[styles.sheet, { backgroundColor: t.surface, height: WORDS_H + 150 + insets.bottom + sp[5] }]} />

      <Animated.FlatList
        ref={list as never}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        style={{ flex: 1 }}
        onLayout={(e) => setTall(e.nativeEvent.layout.height)}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        renderItem={({ item, index }) => <Card slide={item} index={index} x={x} width={width} tall={tall} top={insets.top} />}
      />

      <View style={[styles.foot, { backgroundColor: t.surface, paddingBottom: insets.bottom + sp[5] }]}>
        <Dots x={x} width={width} />
        {asks ? (
          <View style={{ gap: sp[2] }}>
            <Button title="Allow notifications" icon="notifications-outline" onPress={allow} busy={asking} testID="onboarding-allow" />
            <Button title="Not now" kind="plain" onPress={finish} />
          </View>
        ) : (
          <View style={styles.row}>
            <Pressable onPress={finish} hitSlop={12} testID="onboarding-skip" accessibilityRole="button" style={({ pressed }) => [styles.skip, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={{ color: t.muted, fontSize: 16, fontWeight: "600" }}>Skip</Text>
            </Pressable>
            <Pressable
              onPress={() => { tick(); go(at + 1); }}
              testID="onboarding-next"
              accessibilityRole="button"
              accessibilityLabel={last ? "Get started" : "Next"}
              style={({ pressed }) => [styles.next, { backgroundColor: t.brand, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={{ color: t.brandInk, fontSize: 16, fontWeight: "700" }}>Next</Text>
              <Ionicons name="arrow-forward" size={18} color={t.brandInk} />
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
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

/** One screen: the picture on the stage above, its words on the sheet below — both reading the scroll. */
function Card({ slide, index, x, width, tall, top }: { slide: Slide; index: number; x: SharedValue<number>; width: number; tall: number; top: number }) {
  const t = useTheme();
  const tint = slide.tint(t);

  // The picture slides a little slower than the page and shrinks as it goes,
  // which is what makes the stage feel deeper than the sheet.
  const art = useAnimatedStyle(() => {
    const d = near(x.value, index, width);
    return {
      opacity: interpolate(Math.abs(d), [0, 1], [1, 0.2], Extrapolation.CLAMP),
      transform: [{ translateX: d * -width * 0.25 }, { scale: interpolate(Math.abs(d), [0, 1], [1, 0.82], Extrapolation.CLAMP) }],
    };
  });
  // The words come in from the side they are arriving from and lag the page.
  const words = useAnimatedStyle(() => {
    const d = near(x.value, index, width);
    return {
      opacity: interpolate(Math.abs(d), [0, 0.7], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: d * -width * 0.1 }],
    };
  });

  return (
    <View style={[styles.card, { width }, tall > 0 && { height: tall }]}>
      <Animated.View style={[styles.stageArea, { paddingTop: top + sp[4] }, art]}>
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
 * The picture on the stage: a big white disc with the feature's icon, a
 * tinted ring round it, and a few scattered shapes in the accent — the
 * same stray dots and arcs the holiday card's drawing uses, so the way in
 * looks like the app it is introducing. Swap the middle of this for an
 * <Image> or a Lottie when there is proper art — lottie-react-native is not
 * installed (it is a native module, so adding it means a rebuild), and
 * everything around it here is sized to be replaced.
 */
function Art({ icon, tint }: { icon: keyof typeof Ionicons.glyphMap; tint: string }) {
  const t = useTheme();
  return (
    <View style={styles.art}>
      <View style={[styles.halo, { borderColor: alpha(tint, 0.22) }]} />
      <View style={[styles.halo2, { backgroundColor: alpha(tint, 0.14) }]} />
      <View style={[styles.disc, { backgroundColor: t.surface }]}>
        <View style={[styles.discInner, { backgroundColor: alpha(tint, 0.12) }]}>
          <Ionicons name={icon} size={78} color={tint} />
        </View>
      </View>
      <View style={[styles.dot, { top: 26, right: 30, backgroundColor: alpha(tint, 0.55) }]} />
      <View style={[styles.dot, styles.dotSm, { bottom: 44, left: 26, backgroundColor: alpha(tint, 0.45) }]} />
      <View style={[styles.dot, styles.dotXs, { top: 78, left: 44, backgroundColor: alpha(tint, 0.6) }]} />
      <View style={[styles.arc, { borderTopColor: alpha(tint, 0.5) }]} />
      <View style={[styles.arc2, { borderBottomColor: alpha(tint, 0.35) }]} />
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
      width: interpolate(x.value, span, [8, 28, 8], Extrapolation.CLAMP),
      opacity: interpolate(x.value, span, [0.3, 1, 0.3], Extrapolation.CLAMP),
    };
  });
  return <Animated.View style={[styles.pip, { backgroundColor: t.brand }, style]} />;
}

const DISC = 200;

const styles = StyleSheet.create({
  root: { flex: 1 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: SHEET_RADIUS, borderTopRightRadius: SHEET_RADIUS },
  card: { justifyContent: "flex-end" },
  stageArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: sp[4] },
  art: { width: DISC + 120, height: DISC + 120, alignItems: "center", justifyContent: "center" },
  halo: { position: "absolute", width: DISC + 96, height: DISC + 96, borderRadius: (DISC + 96) / 2, borderWidth: 2 },
  halo2: { position: "absolute", width: DISC + 44, height: DISC + 44, borderRadius: (DISC + 44) / 2 },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 6 },
  discInner: { width: DISC - 48, height: DISC - 48, borderRadius: (DISC - 48) / 2, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", width: 16, height: 16, borderRadius: 8 },
  dotSm: { width: 11, height: 11, borderRadius: 5.5 },
  dotXs: { width: 7, height: 7, borderRadius: 3.5 },
  // Strokes of a circle, not circles: only one edge of each is painted.
  arc: { position: "absolute", top: 30, left: 14, width: 56, height: 56, borderRadius: 28, borderWidth: 3, borderColor: "transparent", transform: [{ rotate: "-35deg" }] },
  arc2: { position: "absolute", bottom: 22, right: 18, width: 44, height: 44, borderRadius: 22, borderWidth: 3, borderColor: "transparent", transform: [{ rotate: "20deg" }] },
  words: { height: WORDS_H, paddingHorizontal: sp[6], paddingTop: sp[6], gap: sp[3] },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 36 },
  body: { fontSize: 15.5, lineHeight: 23 },
  foot: { paddingHorizontal: sp[6], gap: sp[5], paddingTop: sp[2] },
  dots: { flexDirection: "row", alignItems: "center", gap: 6, height: 10 },
  pip: { height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skip: { paddingVertical: sp[3], paddingRight: sp[3] },
  next: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingLeft: sp[6], paddingRight: sp[5], height: 54, borderRadius: radius.pill },
});
