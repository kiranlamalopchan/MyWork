import { Button, Column, Text } from "@expo/ui/jetpack-compose";
import { background, fillMaxSize, paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import type { WorkWidgetProps } from "./props";

const WorkWidget = (props: WorkWidgetProps, environment: WidgetEnvironment) => {
  "widget";
  const dark = environment.colorScheme === "dark";
  return (
    <Column modifiers={[fillMaxSize(), background(dark ? "#14241e" : "#f0faf5"), paddingAll(16)]}>
      <Text color={dark ? "#6ee7b7" : "#047857"} style={{ fontSize: 12, fontWeight: "bold" }}>KaamKoRecord</Text>
      <Text color={dark ? "#f1f5f9" : "#17232a"} style={{ fontSize: 18, fontWeight: "bold" }}>{props.title || "Open the app to get started"}</Text>
      <Text color={dark ? "#f1f5f9" : "#17232a"} style={{ fontSize: 14 }}>{props.subtitle}</Text>
      <Button onClick={() => props}><Text>{props.openLabel || "Open clock"}</Text></Button>
    </Column>
  );
};

export default createWidget<WorkWidgetProps>("WorkClock", WorkWidget, { title: "Open the app to get started", subtitle: "", openLabel: "Open clock" });
