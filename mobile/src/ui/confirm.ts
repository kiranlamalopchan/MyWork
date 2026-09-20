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

/**
 * A yes-or-no put to the person as the phone's own dialog, answered as a
 * promise so one question can wait for the last. Not destructive: no
 * warning buzz, the action drawn plainly, and "Not now" rather than
 * "Cancel" — this is an offer, not a check.
 */
export function ask(title: string, message: string | undefined, action: string, later = "Not now"): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(!!globalThis.confirm?.(message ? `${title}\n\n${message}` : title));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: later, style: "cancel", onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
