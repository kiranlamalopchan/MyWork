/**
 * "Are you sure?" — the phone's own alert, or the browser's on the web
 * build, where React Native's Alert is a stub that shows nothing.
 */
import { Alert, Platform } from "react-native";

import { fail, warn } from "./haptics";

export function confirm(title: string, message: string | undefined, action: string, onYes: () => void, destructive = true): void {
  if (destructive) warn();
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(message ? `${title}\n\n${message}` : title)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: destructive ? "destructive" : "default", onPress: onYes },
  ]);
}

export function notify(title: string, message?: string): void {
  fail();
  if (Platform.OS === "web") globalThis.alert?.(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
