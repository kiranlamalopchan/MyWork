import { Link, Text, VStack } from "@expo/ui/swift-ui";
import { containerBackground, font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { WorkWidgetProps } from "./props";

const WorkWidget = (props: WorkWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const dark = environment.colorScheme === "dark";
  const ink = dark ? "#f1f5f9" : "#17232a";
  const accent = dark ? "#6ee7b7" : "#047857";
  return (
    <VStack alignment="leading" spacing={8} modifiers={[containerBackground(dark ? "#14241e" : "#f0faf5", "widget")]}>
      <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(accent)]}>KaamKoRecord</Text>
      <Text modifiers={[font({ size: 16, weight: "bold" }), foregroundStyle(ink)]}>{props.title || "Open the app to get started"}</Text>
      {props.timerStart ? <Text date={new Date(props.timerStart)} dateStyle="timer" modifiers={[font({ size: 24, weight: "bold" }), foregroundStyle(ink)]} /> : null}
      {props.subtitle ? <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.subtitle}</Text> : null}
      <Link destination="mywork://clock" label={props.openLabel || "Open clock"} modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(accent), padding({ vertical: 8 })]} />
    </VStack>
  );
};

export default createWidget<WorkWidgetProps>("WorkClock", WorkWidget, { title: "Open the app to get started", subtitle: "", openLabel: "Open clock" });
