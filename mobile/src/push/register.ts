/**
 * Being buzzed: ask the phone, get Expo's token for it, tell the server.
 *
 * Nothing here runs on the web build, and a phone that says no is simply
 * not registered — the inbox still shows everything.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import { me } from "@/api";

let registered: string | null = null;

export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "MyWork",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#059669",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== "granted") {
    status = (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })).status;
  }
  if (status !== "granted") return null;
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
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    /* not every launcher shows one */
  }
}
