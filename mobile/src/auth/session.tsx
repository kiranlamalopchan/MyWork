/**
 * Who is signed in. The token is in the keychain; `me` is fetched once it
 * is known and kept here for the app bar, the composer and the settings.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { auth, me as meApi, type Me } from "@/api";
import { forgetPushToken, registerForPush } from "@/push/register";

import { getToken, onTokenChange, setToken } from "./token";

type Session = {
  ready: boolean;
  me: Me | null;
  signIn: (username: string, password: string) => Promise<void>;
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
    const token = await getToken();
    if (!token) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await meApi.get());
    } catch {
      // A dead token has already been dropped by the client; anything else
      // (no network) keeps the last known person until it can be checked.
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
    registerForPush().catch(() => {});
  }, []);

  const value = useMemo<Session>(
    () => ({
      ready,
      me,
      signIn: async (username, password) => signedIn(await auth.login(username, password)),
      register: async (username, password) => signedIn(await auth.register(username, password)),
      signOut: async () => {
        try {
          await auth.logout(await forgetPushToken());
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
