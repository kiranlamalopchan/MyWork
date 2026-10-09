import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationResponse } from "expo-notifications";

import { navigateTo } from "@/nav/paths";
import { notifications, setBadge } from "./register";

/** Follow a tap after sign-in and the root navigator are ready, once per response. */
export function useNotificationNavigation(ready: boolean, username?: string) {
  const client = useQueryClient();
  useEffect(() => {
    const Notifications = notifications();
    if (!Notifications || !ready || !username) return;
    let active = true;
    let latest: string | null = null;
    const handled = new Set<string>();
    const follow = async (response: NotificationResponse | null) => {
      if (!active || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const request = response.notification.request;
      if (handled.has(request.identifier)) return;
      handled.add(request.identifier);
      latest = request.identifier;
      const isCurrent = () => active && latest === request.identifier;
      const url = request.content.data?.url;
      const unread = await navigateTo(typeof url === "string" ? url : "/notifications", isCurrent);
      if (!isCurrent()) return;
      for (const key of ["inbox", "unread", "home"]) client.invalidateQueries({ queryKey: [key] });
      if (unread !== null) await setBadge(unread);
      if (isCurrent()) await Notifications.clearLastNotificationResponseAsync();
    };
    const sub = Notifications.addNotificationResponseReceivedListener((response) => { follow(response).catch(() => {}); });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      // A live tap may have arrived while the cold-start response was being read.
      if (latest === null) return follow(response);
    }).catch(() => {});
    return () => { active = false; sub.remove(); };
  }, [ready, username, client]);
}
