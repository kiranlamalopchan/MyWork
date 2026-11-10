import { Link, Text, VStack } from "@expo/ui/swift-ui";
import { font, padding } from "@expo/ui/swift-ui/modifiers";
import { createLiveActivity } from "expo-widgets";
import type { WorkWidgetProps } from "./props";

const ShiftActivity = (props: WorkWidgetProps) => {
  "widget";
  return {
    banner: <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 16 })]}>
      <Text modifiers={[font({ size: 16, weight: "bold" })]}>{props.title}</Text>
      {props.timerStart ? <Text date={new Date(props.timerStart)} dateStyle="timer" modifiers={[font({ size: 28, weight: "bold" })]} /> : null}
      <Link destination="mywork://clock" label={props.openLabel} />
    </VStack>,
    compactLeading: <Text>KKR</Text>,
    compactTrailing: props.timerStart ? <Text date={new Date(props.timerStart)} dateStyle="timer" /> : <Text>—</Text>,
    minimal: <Text>KKR</Text>,
    expandedBottom: <Link destination="mywork://clock" label={props.openLabel} />,
  };
};

export default createLiveActivity("RunningShift", ShiftActivity);
