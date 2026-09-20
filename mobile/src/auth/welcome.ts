/**
 * What the app offers right after a password sign-in, in the phone's own
 * dialogs, once each per phone: the lock for next time, and being buzzed.
 *
 * Both are asked here rather than found — a switch on the profile page is
 * where you change your mind, not where you learn it exists. The order is
 * the lock first: it is about the sign-in that just happened. Turning it on
 * means meeting the lock once (Face ID, the fingerprint reader) before the
 * sign-in is trusted to it, so the phone's own prompt appears, not only
 * ours. Notifications come after, only when the phone has never been
 * asked — the way in usually has, and a phone told "no" or switched off is
 * not asked again. Every "not now" is remembered: nobody is nagged on
 * every sign-in, and the profile switches stay for later.
 */
import * as SecureStore from "expo-secure-store";

import { armBiometric, biometricKind, biometricName, biometricUser, checkBiometric } from "@/auth/biometric";
import { getToken } from "@/auth/token";
import { enablePush, notifications, pushState, pushTurnedOff } from "@/push/register";
import { ask } from "@/ui/confirm";
import { success } from "@/ui/haptics";

const BIO_OFFERED = "mywork.bio.offered";
const PUSH_OFFERED = "mywork.push.offered";

async function offered(key: string, who = ""): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) === (who || "1");
  } catch {
    return false;
  }
}

async function remember(key: string, who = ""): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, who || "1");
  } catch {
    /* asked again next time, then */
  }
}

/**
 * The lock: offered to a person it does not already open for, once. Yes
 * meets the lock, and only a recognised person is kept. Returns whether
 * it is now armed for them.
 */
export async function offerBiometric(username: string): Promise<boolean> {
  const kind = await biometricKind();
  if (!kind) return false;
  if ((await biometricUser()) === username) return true;
  if (await offered(BIO_OFFERED, username)) return false;
  await remember(BIO_OFFERED, username);
  const name = biometricName(kind);
  const yes = await ask(`Sign in with ${name}?`, `Next time, open KaamKoRecord as ${username} without typing your password.`, `Use ${name}`);
  if (!yes) return false;
  const token = await getToken();
  if (!token) return false;
  try {
    if (!(await checkBiometric(`Confirm it's you to turn on ${name}`))) return false;
    await armBiometric(username, token);
  } catch {
    return false;
  }
  success();
  return true;
}

/**
 * Being buzzed: offered when the phone has never been asked — the tour was
 * skipped, or this phone never saw one — and not after a no. Yes runs the
 * phone's own permission prompt and registers this phone.
 */
export async function offerPush(): Promise<boolean> {
  const Notifications = notifications();
  if (!Notifications) return false;
  if ((await pushState()) !== "off" || (await pushTurnedOff())) return false;
  try {
    if ((await Notifications.getPermissionsAsync()).status !== "undetermined") return false;
  } catch {
    return false;
  }
  if (await offered(PUSH_OFFERED)) return false;
  await remember(PUSH_OFFERED);
  const yes = await ask("Turn on notifications?", "A nudge if you are still clocked in, a warning near your hours cap, and what goes up on the notice board. You can change this on your profile.", "Turn on");
  if (!yes) return false;
  return (await enablePush()) === "on";
}

/** After a password sign-in or a new account: the lock, then the buzz. */
export async function welcome(username: string): Promise<void> {
  try {
    await offerBiometric(username);
  } catch {
    /* the offer is never worth failing a sign-in over */
  }
  try {
    await offerPush();
  } catch {
    /* likewise */
  }
}
