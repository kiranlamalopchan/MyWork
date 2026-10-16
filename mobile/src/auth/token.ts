/**
 * Where the token lives: the phone's keychain/keystore through SecureStore;
 * on the web build, localStorage, which is what a browser has.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "mywork.token";
let cached: string | null | undefined;
const listeners = new Set<() => void>();

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  try {
    cached = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  try {
    if (Platform.OS === "web") {
      if (token) globalThis.localStorage?.setItem(KEY, token);
      else globalThis.localStorage?.removeItem(KEY);
    } else if (token) {
      await SecureStore.setItemAsync(KEY, token);
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    /* a phone that refuses the keychain still works for this session */
  }
  listeners.forEach((fn) => fn());
}

/** A 401 may belong to a request sent before the person signed in again. */
export async function signOutEverywhere(expectedToken?: string): Promise<void> {
  if (cached && (expectedToken === undefined || cached === expectedToken)) await setToken(null);
}

export function onTokenChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
