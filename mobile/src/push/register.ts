/**
 * Being buzzed: ask the phone, get Expo's token for it, tell the server.
 *
 * Nothing here runs on the web build, and a phone that says no is simply
 * not registered — the inbox still shows everything. Expo Go on Android
 * has no push at all since SDK 53 and throws the moment expo-notifications
 * is *imported*, so the module is only ever loaded through `notifications()`
 * — never at the top of a file — and Expo Go gets none of this.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";

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

let registered: string | null = null;

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
      name: "MyWork",
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

export async function registerForPush(): Promise<string | null> {
  const Notifications = notifications();
  if (!Notifications || !Device.isDevice) return null;
  if (!(await askForPush())) return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await me.registerDevice(token, Platform.OS, Device.deviceName || Device.modelName || "");
  registered = token;
  return token;
}

/** The token to hand to logout, so the server stops buzzing this phone. */
export async function forgetPushToken(): Promise<string | null> {
  const token = registered;
  registered = null;
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
