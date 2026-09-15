/**
 * The site's paths, which is what a notification carries, mapped to the
 * app's screens — and, for what the app doesn't do yet (timesheets), the
 * site itself in the browser.
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
    return notice ? { screen: `/notices/${notice}` } : { screen: "/(tabs)/board" };
  }
  if ((m = p.match(/^\/notices\/people\/([^/]+)$/))) return { screen: `/people/${m[1]}` };
  if ((m = p.match(/^\/notices\/(\d+)/))) return { screen: `/notices/${m[1]}` };
  if ((m = p.match(/^\/stories\/([^/]+)$/))) return { screen: `/stories/${m[1]}` };
  if (p === "/notifications") return { screen: "/(tabs)/notifications" };
  if (p === "/plu") return { screen: "/(tabs)/plu" };
  if ((m = p.match(/^\/plu\/item\/(\d+)$/))) return { screen: `/plu/${m[1]}` };
  if (p === "/holidays") return { screen: "/holidays" };
  if (p === "/profile") return { screen: "/(tabs)/more" };
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
