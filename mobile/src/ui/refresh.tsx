/**
 * Pull to refresh — and only that.
 *
 * A query's `isRefetching` is true for every refetch, including the ones
 * nobody asked for: coming back to the app asks the screen in front of you
 * again, and a list asks for every page it has loaded, one after another.
 * Handed straight to a RefreshControl, that draws the pull-down spinner
 * over a screen already full of figures and pushes them down to make room —
 * the app looking stuck loading something, when everything is in fact
 * already there and only being checked behind it.
 *
 * So the spinner follows the hand instead. It turns while the pull that
 * asked for it is waited on, and a check nobody asked for passes unseen.
 *
 * Two guards against iOS leaving the spinner stuck on screen with the page
 * shoved down beneath it (seen on the Clock after changing page):
 *
 * - It always turns for at least MIN_SPIN_MS. A refetch answered from cache
 *   lands within a frame, and telling UIRefreshControl to stop while its
 *   own start animation is still running is exactly what strands it — the
 *   control believes it stopped, the inset it opened never closes. A page
 *   change can set this off with no pull at all, when iOS adjusts the scroll
 *   offset on the way in far enough to count as one.
 * - Each time the screen comes back into view, or the app comes back to the
 *   front, the control is replaced by a fresh one unless a pull is genuinely
 *   in progress. A replaced control is taken off its scroll view, which
 *   closes whatever inset an earlier one left open. iOS only: there the
 *   control is a child of the ScrollView, but on Android it wraps the whole
 *   ScrollView, so a new key would rebuild the page under it.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";

import { useTheme } from "./theme";

export const MIN_SPIN_MS = 700;

export function usePullRefresh(refetch: () => Promise<unknown>) {
  const t = useTheme();
  const [pulling, setPulling] = useState(false);
  const [generation, setGeneration] = useState(0);
  const busy = useRef(false), alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const onRefresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setPulling(true);
    const started = Date.now();
    Promise.resolve(refetch())
      // A refetch that failed is the screen's to report, under its own
      // banner. All the spinner owes anybody is to stop turning.
      .catch(() => {})
      .then(() => new Promise((done) => setTimeout(done, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
      .finally(() => {
        busy.current = false;
        if (alive.current) setPulling(false);
      });
  }, [refetch]);

  // A fresh control whenever the screen is shown again, unless a pull is underway.
  const renew = useCallback(() => { if (!busy.current) setGeneration((g) => g + 1); }, []);
  useFocusEffect(renew);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") renew(); });
    return () => sub.remove();
  }, [renew]);

  return (
    <RefreshControl
      key={Platform.OS === "ios" ? generation : undefined}
      refreshing={pulling}
      onRefresh={onRefresh}
      // iOS reads the first of these, Android the other two.
      tintColor={t.brand}
      colors={[t.brand]}
      progressBackgroundColor={t.surface}
    />
  );
}
