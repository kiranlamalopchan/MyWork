/** Device storage is partitioned by server and signed-in account. Never store tokens here. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { serverUrl } from "@/api/server";

type Listener = (value: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const writes = new Map<string, Promise<void>>();
export const privateKey = (scope: string, key: string) => `mywork.private:${scope}:${key}`;
export async function readPrivate<T>(scope: string, key: string, fallback: T): Promise<T> {
  await writes.get(privateKey(scope, key));
  const raw = await AsyncStorage.getItem(privateKey(scope, key));
  return raw === null ? fallback : JSON.parse(raw) as T;
}
export function writePrivate<T>(scope: string, key: string, value: T): Promise<void> {
  const full = privateKey(scope, key);
  const next = (writes.get(full) || Promise.resolve()).catch(() => {}).then(() => AsyncStorage.setItem(full, JSON.stringify(value)));
  writes.set(full, next);
  for (const listener of listeners.get(full) || []) listener(value);
  void next.finally(() => { if (writes.get(full) === next) writes.delete(full); }).catch(() => {});
  return next;
}
export function usePrivateScope(): string | null {
  const { me } = useSession();
  return me ? `${serverUrl()}|${me.username}` : null;
}
export function usePrivateState<T>(key: string, initial: T, errorFallback?: T): [T, (next: T | ((previous: T) => T)) => void, boolean] {
  const scope = usePrivateScope();
  const full = privateKey(scope || "signed-out", key);
  const errorRef = useRef(errorFallback);
  errorRef.current = errorFallback;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const current = useRef(initial);
  const [state, setState] = useState({ full, value: initial, ready: false });
  useEffect(() => {
    let active = true, changed = false;
    current.current = initialRef.current;
    setState({ full, value: initialRef.current, ready: !scope });
    const update: Listener = (value) => {
      changed = true; current.current = value as T;
      if (active) setState({ full, value: value as T, ready: true });
    };
    const group = listeners.get(full) || new Set<Listener>();
    group.add(update); listeners.set(full, group);
    if (scope) readPrivate(scope, key, initialRef.current).then((value) => {
      if (active && !changed) { current.current = value; setState({ full, value, ready: true }); }
    }).catch(() => { if (active && !changed) {
      const value = errorRef.current === undefined ? current.current : errorRef.current;
      current.current = value; setState({ full, value, ready: true });
    } });
    return () => { active = false; group.delete(update); if (!group.size) listeners.delete(full); };
  }, [full, scope, key]);
  const set = useCallback((next: T | ((previous: T) => T)) => {
    const value = typeof next === "function" ? (next as (v: T) => T)(current.current) : next;
    current.current = value;
    setState({ full, value, ready: true });
    if (scope) void writePrivate(scope, key, value).catch(() => {});
  }, [full, key, scope]);
  return [state.full === full ? state.value : initialRef.current, set, state.full === full && state.ready];
}
