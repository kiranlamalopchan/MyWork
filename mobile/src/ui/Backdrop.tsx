/**
 * The ground every screen sits on: a flat, calm grouped background — light
 * grey by day, near-black by night — the panels lift off. Drawn once per
 * screen, under everything, never scrolled.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "./theme";

export function Backdrop() {
  const t = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} />;
}
