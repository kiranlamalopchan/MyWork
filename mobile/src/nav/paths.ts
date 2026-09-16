/**
 * The site's paths, which is what a notification carries, mapped to the
 * app's screens — and, for anything the app doesn't draw, the site itself
 * in the browser.
 */
import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";

import { siteUrl } from "@/api/client";

export type Target = { screen: string; params?: Record<string, string> } | { web: string };

export function targetFor(path: string): Target {
  const url = new URL(path, "http://x");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;
  let m: RegExpMatchArray | null;

  if (p === "/" ) return { screen: "/(tabs)" };
  if (p === "/notices") {
    const notice = q.get("notice");
    return notice ? { screen: `/notices/${notice}` } : { screen: "/board" };
  }
  if (p === "/timesheet") return { screen: "/clock" };
  if (p === "/timesheet/shifts") return { screen: "/timesheet" };
  if (p === "/timesheet/calendar") return { screen: "/timesheet/calendar" };
  if (p === "/timesheet/shifts/add") return { screen: "/shifts/new" };
  if ((m = p.match(/^\/timesheet\/shifts\/(\d+)\/edit$/))) return { screen: `/shifts/${m[1]}/edit` };
  if ((m = p.match(/^\/timesheet\/shifts\/(\d+)$/))) return { screen: `/shifts/${m[1]}` };
  if (p === "/timesheet/workplaces") return { screen: "/workplaces" };
  if (p === "/timesheet/workplaces/add") return { screen: "/workplaces/new" };
  if ((m = p.match(/^\/timesheet\/workplaces\/(\d+)\/edit$/))) return { screen: `/workplaces/${m[1]}/edit` };
  if (p === "/timesheet/pay") return { screen: "/pay" };
  if (p === "/timesheet/more") return { screen: "/more" };
  if ((m = p.match(/^\/notices\/people\/([^/]+)$/))) return { screen: `/people/${m[1]}` };
  if ((m = p.match(/^\/notices\/(\d+)/))) return { screen: `/notices/${m[1]}` };
  if ((m = p.match(/^\/stories\/([^/]+)$/))) return { screen: `/stories/${m[1]}` };
  if (p === "/notifications") return { screen: "/notifications" };
  if (p === "/plu" || p === "/plu/photo-search") return { screen: "/plu" };
  if ((m = p.match(/^\/plu\/item\/(\d+)$/))) return { screen: `/plu/${m[1]}` };
  // Anything else under PLU or the timesheet lands on its tab here.
  if (p.startsWith("/plu/")) return { screen: "/plu" };
  if (p.startsWith("/timesheet/")) return { screen: "/clock" };
  if (p === "/holidays") return { screen: "/holidays" };
  if (p === "/profile") return { screen: "/profile" };
  return { web: path };
}

export async function navigateTo(path: string): Promise<void> {
  const target = targetFor(path);
  if ("web" in target) {
    await openBrowserAsync(siteUrl(target.web));
    return;
  }
  router.push(target.screen as any);
}

/** Back, or — opened cold from a link or a notification — home. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)" as any);
}
