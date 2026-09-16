/**
 * The app bar: the logo mark and the word on the left — or, on a page with
 * somewhere to go back to, the back button and the page's title in the
 * middle — and on the right the bell with its unread count, your own face,
 * and the day/night switch. No rule under it: it frosts over whatever
 * scrolls beneath and otherwise sits on the page's own wash.
 */
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";

import { useUnread } from "@/api";
import { useSession } from "@/auth/session";
import { goBack } from "@/nav/paths";

import { AppMenu } from "./AppMenu";
import { DayNight } from "./DayNight";
import { useLayout } from "./layout";
import { nativeOrNull } from "./native";
import { alpha, APPBAR_H, useTheme } from "./theme";

/** iOS's frosted glass, when this build has it; otherwise the bar is simply opaque. */
const Blur = Platform.OS === "ios" ? nativeOrNull(() => require("expo-blur").BlurView as typeof import("expo-blur").BlurView) : null;

/** The brand mark: the "M" of the site's logo on the brand square. */
export function BrandMark({ size = 32 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: t.brand, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 512 512" fill="none" stroke={t.brandInk} strokeWidth={44} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M136 358V178l120 106 120-106v180" />
      </Svg>
    </View>
  );
}

export function AppBar({ title, back, backLabel, section, right, tools = true }: {
  title?: string; back?: boolean; backLabel?: string; section?: string; right?: React.ReactNode; tools?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const router = useRouter();
  const { me } = useSession();
  const unread = useUnread().data?.unread ?? 0;
  const badge = unread > 99 ? "99+" : String(unread);

  const frost = alpha(t.bg, 0.92);
  const body = (
    <View style={[styles.inner, layout.column, { height: APPBAR_H }]}>
      {back ? (
        <Pressable onPress={goBack} hitSlop={8} accessibilityLabel="Back" testID="appbar-back" style={({ pressed }) => [styles.back, { backgroundColor: pressed ? t.surface3 : t.dark ? t.surface2 : t.surface }, tool(t.dark)]}>
          <Ionicons name="chevron-back" size={22} color={t.text} />
          {backLabel ? <Text style={{ color: t.text, fontSize: 15, fontWeight: "600", marginRight: 4 }} numberOfLines={1}>{backLabel}</Text> : null}
        </Pressable>
      ) : (
        <Pressable onPress={() => router.navigate("/")} style={styles.brand} accessibilityLabel="MyWork, home">
          <BrandMark size={34} />
          <Text style={[styles.brandText, { color: t.text }]}>MyWork</Text>
          {section ? <Text style={[styles.section, { backgroundColor: t.brandSoft, color: t.brand }]}>{section}</Text> : null}
        </Pressable>
      )}
      {back && title ? (
        <Text style={[styles.title, { color: t.text }]} numberOfLines={1} pointerEvents="none">{title}</Text>
      ) : null}
      <View style={styles.tools}>
        {right}
        {tools && me ? (
          <>
            <Pressable onPress={() => router.push("/notifications")} hitSlop={4} accessibilityLabel={unread ? `Alerts, ${unread} unread` : "Alerts"} testID="header-bell" style={({ pressed }) => [styles.bell, { backgroundColor: pressed ? t.surface3 : t.dark ? t.surface2 : t.surface }, tool(t.dark)]}>
              <Ionicons name="notifications-outline" size={21} color={t.text} />
              {unread ? (
                <View style={[styles.badge, { backgroundColor: t.danger, borderColor: t.dark ? t.surface2 : t.surface }]}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
            <AppMenu />
          </>
        ) : null}
        <DayNight />
      </View>
    </View>
  );

  return (
    <View style={[styles.bar, { paddingTop: insets.top, backgroundColor: Platform.OS === "ios" && Blur ? "transparent" : frost }]}>
      {Platform.OS === "ios" && Blur ? (
        <Blur intensity={40} tint={t.dark ? "dark" : "light"} style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(t.bg, 0.55) }]} />
        </Blur>
      ) : null}
      {body}
    </View>
  );
}

/** The round tool buttons' shadow — a lift in the light, nothing in the dark. */
export const tool = (dark: boolean) =>
  Platform.OS === "android" ? { elevation: dark ? 0 : 1 } : dark ? {} : { shadowColor: "#1a2540", shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } };

const styles = StyleSheet.create({
  bar: { zIndex: 40 },
  inner: { flexDirection: "row", alignItems: "center", gap: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 9, marginRight: "auto", flexShrink: 1 },
  brandText: { fontSize: 19, fontWeight: "800", letterSpacing: -0.5 },
  section: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, fontSize: 11.5, fontWeight: "700", letterSpacing: 0.3, textTransform: "uppercase" },
  back: { flexDirection: "row", alignItems: "center", height: 40, minWidth: 40, marginRight: "auto", paddingLeft: 7, paddingRight: 9, borderRadius: 20 },
  title: { position: "absolute", left: "26%", right: "26%", textAlign: "center", fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  tools: { flexDirection: "row", alignItems: "center", gap: 8 },
  bell: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -3, right: -3, minWidth: 19, height: 19, paddingHorizontal: 4, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, fontWeight: "800", lineHeight: 12, color: "#fff" },
});
