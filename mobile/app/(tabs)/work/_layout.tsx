import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "@/ui/theme";

export default function WorkStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: t.bg } }} />;
}
