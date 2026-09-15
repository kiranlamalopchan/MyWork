/** The dock: the same five places the site's tab bar has. */
import React, { useEffect } from "react";
import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useUnread } from "@/api";
import { setBadge } from "@/push/register";
import { useTheme } from "@/ui/theme";

export default function TabsLayout() {
  const t = useTheme();
  const unread = useUnread().data?.unread ?? 0;
  useEffect(() => { setBadge(unread); }, [unread]);

  const icon = (name: keyof typeof Ionicons.glyphMap, outline: keyof typeof Ionicons.glyphMap) =>
    ({ color, focused }: { color: ColorValue; focused: boolean }) => <Ionicons name={focused ? name : outline} size={24} color={color as string} />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.muted,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerTitle: "MyWork", tabBarIcon: icon("home", "home-outline") }} />
      <Tabs.Screen name="board" options={{ title: "Board", headerTitle: "Notice board", tabBarIcon: icon("chatbubbles", "chatbubbles-outline") }} />
      <Tabs.Screen name="plu" options={{ title: "PLU", headerTitle: "PLU lookup", tabBarIcon: icon("search", "search-outline") }} />
      <Tabs.Screen
        name="notifications"
        options={{ title: "Inbox", headerTitle: "Notifications", tabBarIcon: icon("notifications", "notifications-outline"), tabBarBadge: unread ? (unread > 99 ? "99+" : unread) : undefined, tabBarBadgeStyle: { backgroundColor: t.brand, color: t.brandInk } }}
      />
      <Tabs.Screen name="more" options={{ title: "More", headerTitle: "More", tabBarIcon: icon("ellipsis-horizontal-circle", "ellipsis-horizontal-circle-outline") }} />
    </Tabs>
  );
}
