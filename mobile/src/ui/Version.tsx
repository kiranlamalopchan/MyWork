/**
 * Which version this is, at the foot of the profile.
 *
 * Three numbers, answering three different questions. The version is what
 * the stores show and what anybody means by "are you on the new one?". The
 * build in brackets is what EAS stamped into this particular binary, and is
 * the only way to tell two goes at the same version apart. The server's is
 * the one a phone cannot work out for itself — whether the KaamKoRecord it
 * is calling has caught up with the app, or is still running last week's.
 *
 * The app's two are read from the binary rather than from app.json: EAS
 * keeps the build number itself (appVersionSource: remote), so the file on
 * disk is not what shipped. A build without the module shows the version
 * alone.
 *
 * The server's is shown only when it differs from the app's, because saying
 * the same number twice teaches nobody anything — and a mismatch is exactly
 * the thing worth noticing.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import Constants from "expo-constants";

import { useMe } from "@/api";

import { nativeOrNull } from "./native";
import { useTheme } from "./theme";

export function appVersion(): { version: string; build: string } {
  const application = nativeOrNull<typeof import("expo-application")>(() => require("expo-application"));
  return {
    version: application?.nativeApplicationVersion || Constants.expoConfig?.version || "",
    build: application?.nativeBuildVersion || "",
  };
}

/** What the line reads, given what the binary and the server each say. */
export function versionLine(version: string, build: string, server?: string): string {
  if (!version) return server ? `KaamKoRecord · server ${server}` : "";
  const mine = build ? `KaamKoRecord ${version} (${build})` : `KaamKoRecord ${version}`;
  return server && server !== version ? `${mine} · server ${server}` : mine;
}

export function Version() {
  const t = useTheme();
  const { version, build } = appVersion();
  const line = versionLine(version, build, useMe().data?.server_version);
  if (!line) return null;
  return <Text style={[styles.line, { color: t.muted }]} selectable>{line}</Text>;
}

const styles = StyleSheet.create({
  line: { fontSize: 12.5, textAlign: "center", letterSpacing: 0.2, paddingTop: 2 },
});
