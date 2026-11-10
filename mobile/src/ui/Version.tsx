/** The app's version number, quietly shown at the foot of Profile. */
import React from "react";
import { StyleSheet, Text } from "react-native";
import Constants from "expo-constants";
import { useT } from "@/i18n";

import { nativeOrNull } from "./native";
import { useTheme } from "./theme";

export function appVersion(): { version: string; build: string } {
  const application = nativeOrNull<typeof import("expo-application")>(() => require("expo-application"));
  const inExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";
  return {
    version: (!inExpoGo && application?.nativeApplicationVersion) || Constants.expoConfig?.version || "",
    build: (!inExpoGo && application?.nativeBuildVersion) || "",
  };
}

export function Version() {
  const t = useTheme();
  const tr = useT();
  const { version } = appVersion();
  if (!version) return null;
  return <Text style={[styles.line, { color: t.muted }]} testID="app-version" selectable>{tr("Version {version}", { version })}</Text>;
}

const styles = StyleSheet.create({
  line: { fontSize: 12.5, textAlign: "center", letterSpacing: 0.2, paddingTop: 2 },
});
