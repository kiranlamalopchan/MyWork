/**
 * Being buzzed: ask the phone, get Expo's token for it, tell the server.
 *
 * Nothing here runs on the web build, and a phone that says no is simply
 * not registered — the inbox still shows everything. Expo Go on Android
 * has no push at all since SDK 53 and throws the moment expo-notifications
 * is *imported*, so the module is only ever loaded through `notifications()`
 * — never at the top of a file — and Expo Go gets none of this.
 */
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";

import { me } from "@/api";

type NotificationsModule = typeof import("expo-notifications");
let loaded: NotificationsModule | null | undefined;

/** Expo Go (the store app running our JS) rather than a build of our own. */
export const inExpoGo = Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient";

/** The notifications module, or `null` where there is no push: the web, Expo Go on Android, a build without it. */
export function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  if (Platform.OS === "web" || (Platform.OS === "android" && inExpoGo)) return (loaded = null);
  try {
    loaded = require("expo-notifications") as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/**
 * What this phone has said, kept in the keychain so a cold start knows it:
 * the token the server was given (so sign-out can take it back, and the
 * switch can say "on"), and whether the switch was turned off here — the
 * phone's own permission stays granted then, so it is the only thing that
 * tells a later sign-in not to register again.
 */
const TOKEN_KEY = "mywork.push.token";
const OFF_KEY = "mywork.push.off";

async function keep(key: string, value: string | null): Promise<void> {
  try {
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    /* it lasts this run */
  }
}

async function kept(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

/** Whether the switch was turned off on this phone. */
export async function pushTurnedOff(): Promise<boolean> {
  return (await kept(OFF_KEY)) === "1";
}

/**
 * Where the switch sits, for the profile page:
 * - `unsupported` — nothing to switch: the web, Expo Go on Android, a simulator
 * - `blocked` — the phone has said no and will not ask again; only Settings can change that
 * - `on` — the phone may buzz and the server knows this phone
 * - `off` — everything else (never asked, or turned off here)
 */
export type PushState = "unsupported" | "blocked" | "on" | "off";

export async function pushState(): Promise<PushState> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return "unsupported";
  let status = "undetermined";
  let canAskAgain = true;
  try {
    ({ status, canAskAgain } = await Notifications.getPermissionsAsync());
  } catch {
    return "unsupported";
  }
  if (status === "denied" && !canAskAgain) return "blocked";
  if (status === "granted" && !(await pushTurnedOff()) && (await kept(TOKEN_KEY))) return "on";
  return "off";
}

/**
 * Ask the phone, and nothing else.
 *
 * Separate from registering because the two happen at different moments: the
 * way in explains why it wants to buzz you and asks before you have signed
 * in, where telling the server *which* phone to buzz needs an account. The
 * OS only ever prompts once, so by the time sign-in registers the device the
 * answer is already given and nobody is asked twice.
 *
 * Returns whether it may buzz this phone — false on the web, in Expo Go on
 * Android, on a simulator, and when the answer was no.
 */
export async function askForPush(): Promise<boolean> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "KaamKoRecord",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#059669",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return asked.status === "granted";
}

/**
 * Tell the server which phone to buzz. Nothing happens on a phone where the
 * switch was turned off. `quiet` is for a cold start: a token can change
 * between runs, so a phone that already said yes is registered again, but
 * one that has never been asked is not asked now — that prompt belongs to
 * the way in, or to the switch.
 */
export async function registerForPush({ quiet = false }: { quiet?: boolean } = {}): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return null;
  if (await pushTurnedOff()) return null;
  if (quiet) {
    if ((await Notifications.getPermissionsAsync()).status !== "granted") return null;
  } else if (!(await askForPush())) {
    return null;
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await me.registerDevice(token, Platform.OS, Device.deviceName || Device.modelName || "");
  await keep(TOKEN_KEY, token);
  return token;
}

/** The switch turned on: ask if need be, register, and say where it ended up. */
export async function enablePush(): Promise<PushState> {
  await keep(OFF_KEY, null);
  try {
    await registerForPush();
  } catch {
    /* no token on this build, or no server: the state below says so */
  }
  return pushState();
}

/** The switch turned off: the server forgets this phone, and this phone remembers the choice. */
export async function disablePush(): Promise<void> {
  await keep(OFF_KEY, "1");
  const token = await kept(TOKEN_KEY);
  await keep(TOKEN_KEY, null);
  if (token) {
    try {
      await me.unregisterDevice(token);
    } catch {
      /* the server will find the token dead soon enough */
    }
  }
}

/** The phone's own settings page for the app, where a blocked permission is turned back on. */
export function openPushSettings(): Promise<void> {
  return Linking.openSettings();
}

/** The token to hand to logout, so the server stops buzzing this phone. */
export async function forgetPushToken(): Promise<string | null> {
  const token = await kept(TOKEN_KEY);
  await keep(TOKEN_KEY, null);
  return token;
}

export async function setBadge(count: number): Promise<void> {
  const Notifications = notifications();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    /* not every launcher shows one */
  }
}
