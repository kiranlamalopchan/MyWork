/**
 * One tab's stack. Each tab is a stack of its own so the native tab bar
 * underneath stays while a screen pushes over the page; every screen draws
 * the site's app bar itself (ui/AppBar), so the stack draws none.
 */
import React from "react";
import { Stack } from "expo-router";

import { useTheme } from "@/ui/theme";

export function TabStack() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}
