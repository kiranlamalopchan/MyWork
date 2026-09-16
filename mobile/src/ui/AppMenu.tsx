/**
 * You, and only you (base.html's .appmenu): the menu behind your face in
 * the app bar — your profile, and signing out. A panel dropped under the
 * corner, over the page, closed by a tap anywhere else.
 */
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useSession } from "@/auth/session";

import { Avatar } from "./Avatar";
import { confirm } from "./confirm";
import { useLayout } from "./layout";
import { APPBAR_H, radius, sp, useTheme } from "./theme";

export function AppMenu() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  if (!me) return null;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={4} accessibilityLabel="You: your profile, and sign out" testID="header-me">
        <Avatar person={me} size={36} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close menu">
          <View style={[styles.panel, { top: insets.top + APPBAR_H + sp[2], right: layout.column.paddingRight as number, backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent", shadowColor: t.shadow }]}>
            <Pressable onPress={() => { setOpen(false); router.push("/profile"); }} style={({ pressed }) => [styles.item, pressed && { backgroundColor: t.surface2 }]} testID="menu-profile">
              <Avatar person={me} size={36} live={false} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{me.name}</Text>
                <Text style={[styles.sub, { color: t.muted }]} numberOfLines={1}>View profile{me.display_name ? ` · ${me.username}` : ""}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.muted} />
            </Pressable>
            <View style={[styles.rule, { backgroundColor: t.line }]} />
            <Pressable onPress={() => { setOpen(false); confirm("Sign out?", undefined, "Sign out", signOut); }} style={({ pressed }) => [styles.link, pressed && { backgroundColor: t.surface2 }]} testID="menu-signout">
              <Text style={{ color: t.danger, fontWeight: "600", fontSize: 14.5 }}>Sign out</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  panel: { position: "absolute", width: 268, padding: sp[2], borderRadius: radius.lg, borderWidth: 1, shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 16 }, elevation: 12 },
  item: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[2], borderRadius: radius.md },
  name: { fontSize: 14, fontWeight: "700", letterSpacing: -0.1 },
  sub: { fontSize: 12 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: sp[2] },
  link: { padding: sp[2], paddingHorizontal: sp[3], borderRadius: radius.md, minHeight: 40, justifyContent: "center" },
});
