/** The screen behind expo-router's ErrorBoundary: what went wrong, and a way on. */
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "./index";
import { radius, sp, useTheme } from "./theme";

export function Crashed({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const t = useTheme();
  const router = useRouter();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
      <View style={[styles.icon, { backgroundColor: t.dangerSoft }]}>
        <Ionicons name="alert-circle" size={30} color={t.danger} />
      </View>
      <Text style={[styles.title, { color: t.text }]}>Something went wrong</Text>
      <Text style={{ color: t.muted, fontSize: 15, lineHeight: 22, textAlign: "center" }}>This screen hit an error. Trying again usually fixes it; if not, the details below say what happened.</Text>
      <View style={[styles.box, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent" }]}>
        <Text selectable style={{ color: t.text2, fontSize: 13, lineHeight: 19, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) }}>{error.message}</Text>
      </View>
      <Button title="Try again" icon="refresh" onPress={() => { retry(); }} />
      <Button title="Go home" kind="plain" onPress={() => { router.replace("/"); retry(); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: sp[6], gap: sp[3] },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  box: { width: "100%", padding: sp[4], borderRadius: radius.md, borderWidth: 1, marginBottom: sp[2] },
});
