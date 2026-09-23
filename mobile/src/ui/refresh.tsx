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
 */
import React, { useCallback, useState } from "react";
import { RefreshControl } from "react-native";

import { useTheme } from "./theme";

export function usePullRefresh(refetch: () => Promise<unknown>) {
  const t = useTheme();
  const [pulling, setPulling] = useState(false);

  const onRefresh = useCallback(() => {
    setPulling(true);
    Promise.resolve(refetch())
      // A refetch that failed is the screen's to report, under its own
      // banner. All the spinner owes anybody is to stop turning.
      .catch(() => {})
      .finally(() => setPulling(false));
  }, [refetch]);

  return (
    <RefreshControl
      refreshing={pulling}
      onRefresh={onRefresh}
      // iOS reads the first of these, Android the other two.
      tintColor={t.brand}
      colors={[t.brand]}
      progressBackgroundColor={t.surface}
    />
  );
}
