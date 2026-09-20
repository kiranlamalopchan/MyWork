/**
 * Who is signed in. The token is in the keychain; `me` is fetched once it
 * is known and kept here for the app bar, the composer and the settings.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, auth, me as meApi, type Me } from "@/api";
import { loadServer } from "@/api/server";
import { loadLastMe, saveLastMe } from "@/auth/lastMe";
import { forgetPushToken, registerForPush } from "@/push/register";

import { armBiometric, biometricUser, disarmBiometric } from "./biometric";
import { getToken, onTokenChange, setToken } from "./token";

type Session = {
  ready: boolean;
  me: Me | null;
  signIn: (username: string, password: string) => Promise<void>;
  /** With a token the phone's lock has just released (see auth/biometric). */
  signInWithToken: (token: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setMe: (me: Me) => void;
};

const Context = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const client = useQueryClient();

  const load = useCallback(async () => {
    await loadServer();
    const token = await getToken();
    if (!token) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await meApi.get());
      // A push token can change between runs; a phone that already said
      // yes is told to the server again. Never a prompt from here.
      registerForPush({ quiet: true }).catch(() => {});
    } catch (e) {
      // A dead token has already been dropped by the client; anything else
      // (no network) keeps the last known person until it can be checked.
      if (!(e instanceof ApiError && e.status === 401)) setMe(await loadLastMe());
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
    // The API client drops the token on a 401: forget who we were.
    return onTokenChange(async () => {
      if (!(await getToken())) {
        setMe(null);
        client.clear();
      }
    });
  }, [load, client]);

  const signedIn = useCallback(async (result: { token: string; me: Me }) => {
    await setToken(result.token);
    setMe(result.me);
    // A phone that already said yes is told to the server; one that has
    // not is asked by the way in or by auth/welcome, never from here.
    registerForPush({ quiet: true }).catch(() => {});
    // The phone's lock opens for one person: someone else signing in
    // with a password takes that away; the same person keeps it current.
    // Signed in either way — a keychain that refuses can't undo that.
    try {
      const kept = await biometricUser();
      if (kept && kept !== result.me.username) await disarmBiometric();
      else if (kept) await armBiometric(kept, result.token);
    } catch {
      /* the lock just won't be armed for this sign-in */
    }
  }, []);

  // Whoever we are now is who the next cold start draws while it asks —
  // once the keychain has been read, so a start doesn't wipe it first.
  useEffect(() => { if (ready) saveLastMe(me); }, [ready, me]);

  const value = useMemo<Session>(
    () => ({
      ready,
      me,
      signIn: async (username, password) => signedIn(await auth.login(username, password)),
      signInWithToken: async (token) => {
        await setToken(token);
        try {
          const who = await meApi.get();
          setMe(who);
          registerForPush({ quiet: true }).catch(() => {});
        } catch (e) {
          await setToken(null);
          // A token the server no longer knows (signed out everywhere, or
          // the account is gone): the lock can't open it any more. No
          // network is another matter — the lock keeps it for later.
          if (e instanceof ApiError && e.status === 401) {
            await disarmBiometric();
            throw new Error("That sign-in has expired. Sign in with your password once more.");
          }
          throw e;
        }
      },
      register: async (username, password) => signedIn(await auth.register(username, password)),
      signOut: async () => {
        // Signed in by the phone's lock next time? Then the token stays
        // alive on the server; only this screen forgets it.
        const keep = !!me && (await biometricUser()) === me.username;
        try {
          await auth.logout(await forgetPushToken(), keep);
        } catch {
          /* the token is going anyway */
        }
        await setToken(null);
        setMe(null);
        client.clear();
      },
      refresh: async () => setMe(await meApi.get()),
      setMe,
    }),
    [ready, me, signedIn, client]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): Session {
  const session = useContext(Context);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
