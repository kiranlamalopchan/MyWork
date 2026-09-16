/**
 * The phone answering your thumb: a tick when something is chosen, a
 * firmer knock when something is done, a double buzz when it went wrong.
 * Android and iOS both; nothing on the web, and nothing in a build made
 * before the module was added (loaded lazily, like the other natives).
 * Every call is fire-and-forget: haptics never hold up the tap.
 */
import { Platform } from "react-native";

import { nativeOrNull } from "./native";

type Haptics = typeof import("expo-haptics");
let loaded: Haptics | null | undefined;
function haptics(): Haptics | null {
  if (loaded === undefined) loaded = Platform.OS === "web" ? null : nativeOrNull<Haptics>(() => require("expo-haptics"));
  return loaded ?? null;
}

const quiet = () => {};

/** A chip, a segment, a switch, a day on the calendar: a light tick. */
export function tick(): void {
  haptics()?.selectionAsync().catch(quiet);
}

/** A button pressed: a soft, medium or heavy knock. */
export function tap(weight: "light" | "medium" | "heavy" = "light"): void {
  const h = haptics();
  if (!h) return;
  const style = weight === "heavy" ? h.ImpactFeedbackStyle.Heavy : weight === "medium" ? h.ImpactFeedbackStyle.Medium : h.ImpactFeedbackStyle.Light;
  h.impactAsync(style).catch(quiet);
}

/** Saved, sent, clocked in: the phone says "done". */
export function success(): void {
  const h = haptics();
  h?.notificationAsync(h.NotificationFeedbackType.Success).catch(quiet);
}

/** Something refused or removed: a warning buzz. */
export function warn(): void {
  const h = haptics();
  h?.notificationAsync(h.NotificationFeedbackType.Warning).catch(quiet);
}

/** It went wrong: the error buzz. */
export function fail(): void {
  const h = haptics();
  h?.notificationAsync(h.NotificationFeedbackType.Error).catch(quiet);
}
