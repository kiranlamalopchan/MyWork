/**
 * Which version this is, at the foot of the profile.
 *
 * Two numbers, because they answer two different questions. The version is
 * what the stores show and what anybody means by "are you on the new one?".
 * The build in brackets is what EAS stamped into this particular binary,
 * and is the only way to tell two goes at the same version apart — which is
 * exactly what you need when something is being worked out over the phone.
 *
 * Read from the binary rather than from app.json: EAS keeps the build number
 * itself (appVersionSource: remote), so the file on disk is not what shipped.
 * A build without the module simply shows the version alone.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import Constants from "expo-constants";

import { nativeOrNull } from "./native";
import { useTheme } from "./theme";

export function versionLine(): string {
  const application = nativeOrNull<typeof import("expo-application")>(() => require("expo-application"));
  const version = application?.nativeApplicationVersion || Constants.expoConfig?.version || "";
  const build = application?.nativeBuildVersion || "";
  if (!version) return "";
  return build ? `KaamKoRecord ${version} (${build})` : `KaamKoRecord ${version}`;
}

export function Version() {
  const t = useTheme();
  const line = versionLine();
  if (!line) return null;
  return <Text style={[styles.line, { color: t.muted }]} selectable>{line}</Text>;
}

const styles = StyleSheet.create({
  line: { fontSize: 12.5, textAlign: "center", letterSpacing: 0.2, paddingTop: 2 },
});
