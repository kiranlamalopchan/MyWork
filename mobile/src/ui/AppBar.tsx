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
import Svg, { Circle, Defs, LinearGradient, Mask, Path, Rect, Stop } from "react-native-svg";
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

/**
 * The brand mark: the app's own icon, the clock on its navy tile. Drawn
 * rather than loaded so it is sharp at any size, and its gradient stops get
 * ids of their own — on the web every one of these lands in the one document,
 * and a shared id would have them all wear the first one's paint.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const id = React.useId();
  const plate = `bm-plate-${id}`;
  const mark = `bm-mark-${id}`;
  const ticks = `bm-ticks-${id}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id={plate} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1a2740" />
          <Stop offset="1" stopColor="#0b111a" />
        </LinearGradient>
        <LinearGradient id={mark} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#40e7a0" />
          <Stop offset="1" stopColor="#24bd82" />
        </LinearGradient>
        <Mask id={ticks}>
          <Rect width={512} height={512} fill="#fff" />
          <Rect x={250} y={94} width={12} height={54} fill="#000" />
          <Rect x={364} y={250} width={54} height={12} fill="#000" />
          <Rect x={250} y={364} width={12} height={54} fill="#000" />
          <Rect x={94} y={250} width={54} height={12} fill="#000" />
        </Mask>
      </Defs>
      <Rect width={512} height={512} rx={102} fill={`url(#${plate})`} />
      <Circle cx={256} cy={256} r={138} fill="none" stroke={`url(#${mark})`} strokeWidth={18} mask={`url(#${ticks})`} />
      <Path d="M256 256l66 42" stroke={`url(#${mark})`} strokeWidth={14} strokeLinecap="round" />
      <Circle cx={256} cy={256} r={15} fill={`url(#${mark})`} />
    </Svg>
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
        <Pressable onPress={() => router.navigate("/")} style={styles.brand} accessibilityLabel="MeroKaam, home">
          <BrandMark size={34} />
          <Text style={[styles.brandText, { color: t.text }]}>MeroKaam</Text>
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
