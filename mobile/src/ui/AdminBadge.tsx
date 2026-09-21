/**
 * The mark beside an admin's name — a shield with a tick and the word, in
 * the brand colour — so whoever runs the board is known as such wherever
 * they are named: on a notice, a comment, a story, a friend row, a page.
 * Nothing at all for everybody else. `light` is for the story viewer,
 * where the name sits in white on the picture.
 */
import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Person } from "@/api/types";

import { useTheme } from "./theme";

export function AdminBadge({ person, size = 11, light = false }: { person: Pick<Person, "is_admin">; size?: number; light?: boolean }) {
  const t = useTheme();
  if (!person.is_admin) return null;
  const ink = light ? "#fff" : t.brand;
  return (
    <View
      accessibilityLabel="Admin"
      testID="admin-badge"
      style={{
        flexDirection: "row", alignItems: "center", gap: 3,
        paddingLeft: 5, paddingRight: 7, paddingVertical: 1.5, borderRadius: 999,
        backgroundColor: light ? "rgba(255,255,255,0.22)" : t.brandSoft,
      }}
    >
      <Ionicons name="shield-checkmark" size={size + 1} color={ink} />
      <Text style={{ color: ink, fontSize: size, fontWeight: "700", letterSpacing: 0.2 }}>Admin</Text>
    </View>
  );
}
