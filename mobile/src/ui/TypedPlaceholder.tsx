/**
 * A placeholder that types itself, for a box you are meant to search in.
 *
 * A search box with a static grey sentence in it is a label; one with a
 * phrase being typed into it is an invitation, and it answers the question
 * the PLU box actually raises — *what* can I put in here? — by alternating a
 * name and a number rather than saying "number or description" and leaving
 * you to guess the shape of either.
 *
 * Realism is the point, so it is not a metronome: every keystroke is a
 * slightly different length, a word occasionally pauses as if the person
 * were thinking, deleting is much faster than typing (a held backspace, not
 * eight considered ones), and the caret blinks at the rate macOS uses.
 *
 * It stops the moment the box is yours — focused or typed in — and it never
 * runs at all for somebody who has asked the system to reduce motion, who
 * gets the sentence whole. It is decoration either way: the input carries
 * the real accessibility label, and this is hidden from the screen reader.
 */
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View, type TextStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from "react-native-reanimated";

/** How long one keystroke takes, and how long a thought does. */
const KEY_MS = 68;
const KEY_JITTER = 46;
const THINK_MS = 260;
const THINK_CHANCE = 0.08;
const HOLD_MS = 1500;
const DELETE_MS = 38;
const BETWEEN_MS = 340;
const BLINK_MS = 530;

const jitter = () => KEY_MS + Math.random() * KEY_JITTER + (Math.random() < THINK_CHANCE ? THINK_MS : 0);

export function TypedPlaceholder({ phrases, prefix = "", show, style }: {
  phrases: string[];
  prefix?: string;
  /** False once the box has focus or anything in it — then this gets out of the way. */
  show: boolean;
  style?: TextStyle;
}) {
  const [shown, setShown] = useState("");
  const [still, setStill] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setStill(on); });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => { alive = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (!show || still || !phrases.length) return;
    // Each step schedules the next one, so the gaps can differ — an interval
    // would type every character at exactly the same speed, which is the one
    // thing a person never does.
    let phrase = 0;
    let at = 0;
    let erasing = false;
    const step = () => {
      const word = phrases[phrase % phrases.length];
      if (!erasing) {
        at += 1;
        setShown(word.slice(0, at));
        if (at >= word.length) { erasing = true; timer.current = setTimeout(step, HOLD_MS); return; }
        timer.current = setTimeout(step, jitter());
        return;
      }
      at -= 1;
      setShown(word.slice(0, Math.max(at, 0)));
      if (at <= 0) { erasing = false; phrase += 1; timer.current = setTimeout(step, BETWEEN_MS); return; }
      timer.current = setTimeout(step, DELETE_MS);
    };
    timer.current = setTimeout(step, BETWEEN_MS);
    return () => { if (timer.current) clearTimeout(timer.current); setShown(""); };
  }, [show, still, phrases]);

  const blink = useSharedValue(1);
  useEffect(() => {
    if (!show || still) return;
    blink.value = 1;
    blink.value = withRepeat(withTiming(0, { duration: BLINK_MS, easing: Easing.steps(2, true) }), -1, true);
  }, [show, still, blink]);
  const caret = useAnimatedStyle(() => ({ opacity: blink.value }));

  if (!show) return null;

  return (
    <View style={styles.wrap} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* flexShrink, never flexGrow: a Text told to fill the row would push
          the caret to the far end of the box instead of sitting after the
          last letter, which is where a caret is. */}
      <Text numberOfLines={1} style={[style, { flexGrow: 0, flexShrink: 1 }]}>
        {still ? `${prefix}${phrases[0]}` : `${prefix}${shown}`}
      </Text>
      {still ? null : <Animated.View style={[styles.caret, caret, { backgroundColor: style?.color }]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, flexDirection: "row", alignItems: "center" },
  // A caret, not a "|": a rule sits on the text's own line and does not
  // inherit the font's letter spacing the way a pipe would.
  caret: { width: 2, height: 20, marginLeft: 2, borderRadius: 1 },
});
