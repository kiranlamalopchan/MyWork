/**
 * Whether this phone has been shown the way in.
 *
 * Kept where theme.ts and auth/token.ts keep their small things — the
 * keychain on a phone, localStorage on the web build — rather than bringing
 * in a store of its own for one boolean.
 *
 * Read once at launch, behind the splash, so nobody ever sees the app decide.
 * A phone that refuses to answer is treated as having seen it: showing the
 * tour twice is worse than never showing it, and the app is reachable either
 * way.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "mywork.onboarded";

export async function loadSeen(): Promise<boolean> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw === "1";
  } catch {
    return true;
  }
}

export async function saveSeen(): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, "1");
    else await SecureStore.setItemAsync(KEY, "1");
  } catch {
    /* it lasts this run, and the tour is not worth failing a launch over */
  }
}

/** Puts it back — the tour runs again next launch. For looking at it while building. */
export async function forgetSeen(): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* nothing to undo then */
  }
}

type Onboarding = {
  /** False until the keychain has answered; the splash stays up that long. */
  checked: boolean;
  seen: boolean;
  finish: () => void;
};

const Context = createContext<Onboarding | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSeen().then((was) => { if (alive) { setSeen(was); setChecked(true); } });
    return () => { alive = false; };
  }, []);

  // Marked at once and written behind it: the screen should not wait on a
  // keychain to close, and a write that fails has cost nothing.
  const finish = useCallback(() => { setSeen(true); saveSeen().catch(() => {}); }, []);

  const value = useMemo(() => ({ checked, seen, finish }), [checked, seen, finish]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOnboarding(): Onboarding {
  const value = useContext(Context);
  if (!value) throw new Error("useOnboarding outside OnboardingProvider");
  return value;
}
