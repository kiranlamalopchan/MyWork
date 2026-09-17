/**
 * Signing in with the phone's own lock — Face ID, a fingerprint — once a
 * password has been given the first time. The token from that sign-in
 * is kept in the keychain under a second key that outlives signing out;
 * the phone's prompt (expo-local-authentication) stands between the
 * screen and that key. Nothing here on the web build.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { nativeOrNull } from "@/ui/native";

const TOKEN_KEY = "mywork.bio.token";
const USER_KEY = "mywork.bio.user";

export type BiometricKind = "face" | "fingerprint" | "iris";

type LocalAuth = typeof import("expo-local-authentication");
const localAuth = () => (Platform.OS === "web" ? null : nativeOrNull(() => require("expo-local-authentication") as LocalAuth));

/** What the phone can check with — or null when it can't (no hardware, nothing enrolled, the web). */
export async function biometricKind(): Promise<BiometricKind | null> {
  const LA = localAuth();
  if (!LA) return null;
  try {
    if (!(await LA.hasHardwareAsync()) || !(await LA.isEnrolledAsync())) return null;
    const types = await LA.supportedAuthenticationTypesAsync();
    if (types.includes(LA.AuthenticationType.FACIAL_RECOGNITION)) return "face";
    if (types.includes(LA.AuthenticationType.FINGERPRINT)) return "fingerprint";
    if (types.includes(LA.AuthenticationType.IRIS)) return "iris";
    return null;
  } catch {
    return null;
  }
}

/** The lock's name the way the phone calls it. */
export function biometricName(kind: BiometricKind | null): string {
  if (kind === "face") return Platform.OS === "ios" ? "Face ID" : "face unlock";
  if (kind === "fingerprint") return Platform.OS === "ios" ? "Touch ID" : "fingerprint";
  return "biometrics";
}

/** Who can sign in this way on this phone, if anyone. */
export async function biometricUser(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return (await SecureStore.getItemAsync(USER_KEY)) || null;
  } catch {
    return null;
  }
}

/** Keep this sign-in for the lock to open next time. */
export async function armBiometric(username: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, username);
}

export async function disarmBiometric(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  } catch {
    /* nothing kept, nothing to drop */
  }
}

/** The phone's prompt: true when the person was recognised. */
export async function checkBiometric(promptMessage: string, cancelLabel = "Cancel"): Promise<boolean> {
  const LA = localAuth();
  if (!LA) throw new Error("This phone can't sign you in that way.");
  const result = await LA.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false });
  return result.success;
}

/**
 * The phone's prompt, then the kept token — or null when the person
 * cancelled or wasn't recognised. Throws only when nothing is kept.
 */
export async function unlockWithBiometric(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) throw new Error("Sign in with your password first, then turn this on.");
  return (await checkBiometric("Sign in to MeroKaam", "Use password")) ? token : null;
}
