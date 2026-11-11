import { Circle, HStack, Image, Link, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { activityBackgroundTint, background, font, foregroundStyle, frame, lineLimit, monospacedDigit, multilineTextAlignment, opacity, padding, shapes } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import type { WorkWidgetProps } from "./props";

/**
 * The running shift on the Lock Screen and in the Dynamic Island.
 *
 * One colour says the state at a glance — green while you work, amber on a
 * break — on a briefcase or a cup, beside a ticking timer:
 * - compact: the icon on the left of the camera, the timer on the right
 *   (fixed width, so the island doesn't twitch as the seconds change);
 * - minimal (when another app shares the island): the icon alone;
 * - expanded (long press): state and place, a large timer, and when you
 *   came in beside a button to the clock;
 * - Lock Screen: the same, as a banner on a dark tint.
 *
 * The "widget" body runs in the extension on its own, so everything it
 * needs is defined inside it.
 */
const ShiftActivity = (props: WorkWidgetProps, environment: LiveActivityEnvironment) => {
  "widget";
  const onBreak = props.mode === "break";
  const accent = onBreak ? "#FBBF24" : "#34D399";
  const symbol = onBreak ? "cup.and.saucer.fill" : "briefcase.fill";
  const dim = environment.isLuminanceReduced ? 0.7 : 1;
  const label = (props.stateLabel || props.title || "").toUpperCase();
  const timer = (size: number, weight: "semibold" | "bold") => props.timerStart
    ? <Text date={new Date(props.timerStart)} dateStyle="timer"
        modifiers={[font({ size, weight, design: "rounded" }), monospacedDigit(), foregroundStyle(accent), multilineTextAlignment("trailing"), opacity(dim)]} />
    : <Text modifiers={[font({ size, weight, design: "rounded" }), foregroundStyle(accent)]}>—</Text>;
  const badge = (size: number) => <ZStack>
    <Circle modifiers={[foregroundStyle(accent), opacity(0.22), frame({ width: size, height: size })]} />
    <Image systemName={symbol} size={size * 0.46} color={accent} />
  </ZStack>;

  return {
    banner: <HStack spacing={14} modifiers={[padding({ horizontal: 18, vertical: 16 }), activityBackgroundTint("#0B1512")]}>
      {badge(46)}
      <VStack alignment="leading" spacing={3}>
        <Text modifiers={[font({ size: 12, weight: "bold" }), foregroundStyle(accent)]}>{label}</Text>
        <Text modifiers={[font({ size: 17, weight: "semibold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{props.place || props.title}</Text>
        {props.subtitle ? <Text modifiers={[font({ size: 13 }), foregroundStyle("#A7B4AE"), lineLimit(1)]}>{props.subtitle}</Text> : null}
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={2}>
        {timer(30, "bold")}
        <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundStyle("#A7B4AE")]}>KaamKoRecord</Text>
      </VStack>
    </HStack>,

    compactLeading: <Image systemName={symbol} size={15} color={accent} modifiers={[padding({ leading: 4 })]} />,
    compactTrailing: props.timerStart
      ? <Text date={new Date(props.timerStart)} dateStyle="timer"
          modifiers={[font({ size: 15, weight: "semibold", design: "rounded" }), monospacedDigit(), foregroundStyle(accent), multilineTextAlignment("trailing"), frame({ maxWidth: 56 })]} />
      : <Text modifiers={[foregroundStyle(accent)]}>—</Text>,
    minimal: <Image systemName={symbol} size={14} color={accent} />,

    expandedLeading: <HStack spacing={10} modifiers={[padding({ leading: 6, top: 6 })]}>
      {badge(38)}
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 11, weight: "bold" }), foregroundStyle(accent)]}>{label}</Text>
        <Text modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle("#FFFFFF"), lineLimit(1)]}>{props.place || props.title}</Text>
      </VStack>
    </HStack>,
    expandedTrailing: <VStack alignment="trailing" modifiers={[padding({ trailing: 6, top: 8 })]}>
      {timer(26, "bold")}
    </VStack>,
    expandedBottom: <HStack modifiers={[padding({ horizontal: 6, top: 6 })]}>
      {props.subtitle ? <Text modifiers={[font({ size: 13 }), foregroundStyle("#A7B4AE"), lineLimit(1)]}>{props.subtitle}</Text> : null}
      <Spacer />
      <Link destination="mywork://clock" label={props.openLabel}
        modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle("#0B1512"), padding({ horizontal: 14, vertical: 7 }), background(accent, shapes.capsule())]} />
    </HStack>,
  };
};

export default createLiveActivity("RunningShift", ShiftActivity);
