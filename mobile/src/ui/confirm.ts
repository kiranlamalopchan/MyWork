/** "Are you sure?" — the phone's own alert. */
import { Alert } from "react-native";

import { fail, success, warn } from "./haptics";

export function confirm(title: string, message: string | undefined, action: string, onYes: () => void, destructive = true): void {
  if (destructive) warn();
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: destructive ? "destructive" : "default", onPress: onYes },
  ]);
}

export function notify(title: string, message?: string): void {
  fail();
  Alert.alert(title, message);
}

/**
 * The same, for something that went right. `notify` buzzes the failure
 * pattern, which is wrong under the word "Saved": the hand is told the
 * opposite of what the screen says.
 */
export function tell(title: string, message?: string): void {
  success();
  Alert.alert(title, message);
}

/**
 * A yes-or-no put to the person as the phone's own dialog, answered as a
 * promise so one question can wait for the last. Not destructive: no
 * warning buzz, the action drawn plainly, and "Not now" rather than
 * "Cancel" — this is an offer, not a check.
 */
export function ask(title: string, message: string | undefined, action: string, later = "Not now"): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: later, style: "cancel", onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
