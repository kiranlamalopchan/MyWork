import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationResponse } from "expo-notifications";

import { timesheet } from "@/api";
import { tr } from "@/i18n";
import { errorMessage } from "@/api/errors";
import { navigateTo } from "@/nav/paths";
import { ACTION_CLOCK_OUT, ACTION_END_BREAK, ACTION_START_BREAK } from "@/roster/reminders";
import { notify } from "@/ui/confirm";
import { notifications, setBadge } from "./register";

// A button on the lock-screen shift: what it does to the clock.
const CLOCK_ACTIONS: Record<string, () => Promise<unknown>> = {
  [ACTION_CLOCK_OUT]: timesheet.clockOut,
  [ACTION_START_BREAK]: timesheet.startBreak,
  [ACTION_END_BREAK]: timesheet.endBreak,
};

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
      if (!active || !response) return;
      const request = response.notification.request;
      const move = CLOCK_ACTIONS[response.actionIdentifier];
      if (move) {
        // One press, one move — the same response is handed over again on the next start.
        const once = `${request.identifier}:${response.actionIdentifier}:${response.notification.date}`;
        if (handled.has(once)) return;
        handled.add(once);
        try {
          // A notification may belong to a shift or account that has since
          // ended. Never let its button change a different running shift.
          const expected = request.content.data?.shiftId;
          if (typeof expected === "number") {
            const current = await timesheet.clock();
            if (active && current.shift?.id === expected) await move();
          }
        } catch (error: any) {
          notify(tr("The clock didn't move"), errorMessage(error));
        }
        for (const key of ["clock", "timesheet", "calendar", "trend", "pay", "more", "home"]) client.invalidateQueries({ queryKey: [key] });
        if (active) await navigateTo("/timesheet/");
        await Notifications.clearLastNotificationResponseAsync().catch(() => {});
        return;
      }
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
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
