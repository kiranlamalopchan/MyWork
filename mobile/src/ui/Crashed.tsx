/** The screen behind expo-router's ErrorBoundary: what went wrong, and a way on. */
import React, { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "./index";
import { sp, useTheme } from "./theme";
import { describeError, errorMessage } from "@/api/errors";
import { useT } from "@/i18n";

export function Crashed({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const t = useTheme();
  const router = useRouter();
  const tr = useT();
  useEffect(() => { errorMessage(error); }, [error]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
      <View style={[styles.icon, { backgroundColor: t.dangerSoft }]}>
        <Ionicons name="alert-circle" size={30} color={t.danger} />
      </View>
      <Text accessibilityRole="alert" style={[styles.title, { color: t.text }]}>{tr("Something went wrong")}</Text>
      <Text style={{ color: t.muted, fontSize: 15, lineHeight: 22, textAlign: "center" }}>{describeError(error).message}</Text>
      <Button title={tr("Try again")} icon="refresh" onPress={() => { void retry(); }} />
      <Button title={tr("Go home")} kind="plain" onPress={() => { router.replace("/"); void retry(); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: sp[6], gap: sp[3] },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
});
