/**
 * The tab bar: the same five places the site's has — Home, PLU, Clock,
 * Timesheet, More — drawn by the phone itself. On iOS that is the system
 * bar (glass on iOS 26, shrinking to its icons as you scroll, the way the
 * site's dock does); on Android, Material's. Alerts are not a tab here
 * either: the bell is in every tab's header (TabStack).
 *
 * The web build, which is only for driving the screens in a browser, keeps
 * the JavaScript bar: the native one has no icons there.
 */
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Ionicons } from "@expo/vector-icons";

import { useUnread } from "@/api";
import { setBadge } from "@/push/register";
import { useTheme } from "@/ui/theme";

const TABS = [
  { name: "(home)", title: "Home", sf: { default: "house", selected: "house.fill" }, md: "home", ion: ["home", "home-outline"] },
  { name: "plu", title: "PLU", sf: { default: "magnifyingglass", selected: "magnifyingglass" }, md: "search", ion: ["search", "search-outline"] },
  { name: "clock", title: "Clock", sf: { default: "clock", selected: "clock.fill" }, md: "schedule", ion: ["time", "time-outline"] },
  { name: "timesheet", title: "Timesheet", sf: { default: "calendar", selected: "calendar" }, md: "calendar_month", ion: ["calendar", "calendar-outline"] },
  { name: "more", title: "More", sf: { default: "ellipsis.circle", selected: "ellipsis.circle.fill" }, md: "more_horiz", ion: ["ellipsis-horizontal-circle", "ellipsis-horizontal-circle-outline"] },
] as const;

export default function TabsLayout() {
  const t = useTheme();

  // The number on the app's icon follows the inbox wherever you are.
  const unread = useUnread().data?.unread ?? 0;
  useEffect(() => { setBadge(unread); }, [unread]);

  if (Platform.OS === "web") {
    return (
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
          tabBarActiveTintColor: t.brand, tabBarInactiveTintColor: t.muted,
          sceneStyle: { backgroundColor: t.bg },
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: tab.title,
              tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? tab.ion[0] : tab.ion[1]} size={24} color={color} />,
            }}
          />
        ))}
      </Tabs>
    );
  }

  return (
    <NativeTabs
      tintColor={t.brand}
      minimizeBehavior="onScrollDown"
      labelStyle={{ fontWeight: "600" }}
      iconColor={{ default: t.muted, selected: t.brand }}
      backgroundColor={Platform.OS === "android" ? t.surface : undefined}
      indicatorColor={t.brandSoft}
      rippleColor={t.brandSoft}
    >
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.title}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
