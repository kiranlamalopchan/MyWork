/**
 * Where the Django site is. In order: an address the person typed on the
 * sign-in screen (kept on the phone), `EXPO_PUBLIC_API_URL` baked into the
 * build, or — while running from Metro with no .env — the laptop Metro is
 * on, port 8000, which is where `runserver 0.0.0.0:8000` answers. Never
 * `localhost`: on a phone that is the phone.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const KEY = "mywork.server";
let chosen: string | null | undefined;

export function defaultServer(): string {
  const env = (process.env.EXPO_PUBLIC_API_URL || "").trim();
  if (env) return clean(env);
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && Platform.OS !== "web") return `http://${host}:8000`;
  return "http://localhost:8000";
}

/** Called once at start, before the first request. */
export async function loadServer(): Promise<string> {
  if (chosen !== undefined) return serverUrl();
  try {
    chosen = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
  } catch {
    chosen = null;
  }
  return serverUrl();
}

export function serverUrl(): string {
  return chosen || defaultServer();
}

export function isCustomServer(): boolean {
  return !!chosen;
}

/** Set the address, or clear it (`null`) to go back to the build's own. */
export async function setServer(url: string | null): Promise<void> {
  const value = url ? clean(url) : null;
  chosen = value;
  try {
    if (Platform.OS === "web") {
      if (value) globalThis.localStorage?.setItem(KEY, value);
      else globalThis.localStorage?.removeItem(KEY);
    } else if (value) {
      await SecureStore.setItemAsync(KEY, value);
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    /* kept for this session at least */
  }
}

/** "192.168.0.11:8000" → "http://192.168.0.11:8000"; trailing slashes off. */
export function clean(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}
