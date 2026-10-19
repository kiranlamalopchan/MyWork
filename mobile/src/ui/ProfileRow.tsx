import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { alpha, useTheme } from "./theme";

/** A quiet navigation row shared by Profile and its settings. */
export function ProfileRow({ icon, title, description, onPress, testID, danger = false, centred = false }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; description?: string; onPress: () => void;
  testID?: string; danger?: boolean; centred?: boolean;
}) {
  const t = useTheme();
  const colour = danger ? t.danger : t.text2;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={description} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.row, centred && styles.centred, pressed && { backgroundColor: alpha(t.brand, .07) }]}>
    <Ionicons name={icon} size={20} color={colour} />
    <View style={!centred && { flex: 1, minWidth: 0 }}>
      <Text style={[styles.title, { color: danger ? t.danger : t.text2 }]}>{title}</Text>
      {description ? <Text style={[styles.description, { color: t.muted }]}>{description}</Text> : null}
    </View>
    {!centred ? <Ionicons name="chevron-forward" size={16} color={t.muted} /> : null}
  </Pressable>;
}
const styles = StyleSheet.create({
  row: { minHeight: 60, paddingHorizontal: 22, paddingVertical: 16, gap: 18, flexDirection: "row", alignItems: "center" },
  centred: { justifyContent: "center", gap: 10 },
  title: { fontSize: 15, lineHeight: 21 },
  description: { fontSize: 12, lineHeight: 17, marginTop: 3 },
});
