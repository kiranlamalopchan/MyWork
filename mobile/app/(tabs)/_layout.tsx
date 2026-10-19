import React, { useEffect } from "react";
import { Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";

import { useUnread } from "@/api";
import { setBadge } from "@/push/register";
import { useTheme } from "@/ui/theme";

const TABS = [
  { name: "(home)", title: "Home", sf: { default: "house", selected: "house.fill" }, md: "home" },
  { name: "plu", title: "Items", sf: { default: "magnifyingglass", selected: "magnifyingglass" }, md: "search" },
  { name: "work", title: "Work", sf: { default: "briefcase", selected: "briefcase.fill" }, md: "work" },
  { name: "alerts", title: "Alerts", sf: { default: "bell", selected: "bell.fill" }, md: "notifications" },
  { name: "account", title: "Profile", sf: { default: "person.crop.circle", selected: "person.crop.circle.fill" }, md: "account_circle" },
] as const;

export default function TabsLayout() {
  const t = useTheme();
  // The number on the app's icon follows the inbox wherever you are.
  const unread = useUnread().data?.unread ?? 0;
  useEffect(() => { setBadge(unread); }, [unread]);
  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <NativeTabs
      tintColor={t.brand}
      badgeBackgroundColor={t.danger}
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
          {tab.name === "alerts" && unread > 0 ? <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge> : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
