import { Linking, Platform } from "react-native";
import { api } from "@/api/client";
export const ANDROID_STORE = "https://play.google.com/store/apps/details?id=com.kiranlama.merokaam";
export const IOS_STORE = "https://apps.apple.com/app/id6813073450";
export function validStoreUrl(value: unknown, platform: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (platform === "android" && url.hostname === "play.google.com" && url.pathname === "/store/apps/details" && url.searchParams.get("id") === "com.kiranlama.merokaam") return url.toString();
    if (platform === "ios" && url.hostname === "apps.apple.com" && /\/id6813073450\/?$/.test(url.pathname)) return url.toString();
  } catch {}
  return null;
}
export async function openAppStore(isCurrent: () => boolean = () => true): Promise<void> {
  const platform = Platform.OS;
  let target = platform === "android" ? ANDROID_STORE : IOS_STORE;
  try {
    const release = await api<{ android_url: string; ios_url: string }>("mobile/release/");
    target = validStoreUrl(platform === "android" ? release.android_url : release.ios_url, platform) || target;
  } catch { /* Older deployments still have the app's known store destinations. */ }
  if (isCurrent()) await Linking.openURL(target);
}
