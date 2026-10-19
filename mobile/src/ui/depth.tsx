/**
 * The page under the app bar.
 *
 * The bar floats over the page (ui/AppBar): the page runs the full height of
 * the screen and scrolls up under the bar's glass, the way a native app's
 * does. So every scrolling page starts its content one bar's height down,
 * as plain top padding on every platform, and its pull-to-refresh spinner is
 * moved down by the same amount so it shows below the bar. (iOS once used a
 * content inset with a matching starting offset instead; a page pushed onto
 * the stack did not always get the offset, and opened with its heading under
 * the back button.)
 *
 * Each page's scrolling also tells the chrome which way it is going, so the
 * bar can step aside on the way down and come back at the top
 * (ui/chrome.ts). Only that crossing is reported — nothing per frame — which
 * keeps scrolling on the native thread and smooth.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { Platform, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type RefreshControlProps, type View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CHROME_TOP, followScroll } from "./chrome";
import type { Measurable } from "./keyboard";

const BarSpace = createContext(0);

/** `space`: how much of the top of the screen the bar covers — status bar and all. */
export function BarSpaceProvider({ space, children }: { space: number; children: React.ReactNode }) {
  return <BarSpace.Provider value={space}>{children}</BarSpace.Provider>;
}

export function useBarSpace() {
  return useContext(BarSpace);
}

export type UnderBar = {
  /** Spread onto the ScrollView / FlatList. */
  scroll: {
    scrollIndicatorInsets?: { top: number };
    automaticallyAdjustContentInsets: false;
    contentInsetAdjustmentBehavior: "never";
  };
  /** Add to the content container's top padding. */
  padTop: number;
  /** How far down the pull-to-refresh spinner is drawn. */
  refreshOffset: number;
  /** Feed every scroll event here. */
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

/** What a vertical page needs to sit under the floating bar. */
export function useUnderBar(): UnderBar {
  const space = useContext(BarSpace);
  const travel = useRef({ y: 0, run: 0 } as { y: number; run: number; view?: number });
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = e.nativeEvent;
    if (!n.contentSize || !n.layoutMeasurement) return;
    followScroll(travel.current, n);
  }, []);
  return useMemo(() => ({
    scroll: {
      ...(Platform.OS === "ios" && space ? { scrollIndicatorInsets: { top: space } } : null),
      automaticallyAdjustContentInsets: false as const,
      contentInsetAdjustmentBehavior: "never" as const,
    },
    padTop: space,
    refreshOffset: space,
    onScroll,
  }), [space, onScroll]);
}

/**
 * For a list built by the screen itself, outside the Screen's own tree, where
 * the hook cannot reach the screen's bar: render the list through this.
 */
export function WithDepth({ children }: { children: (under: UnderBar) => React.ReactNode }) {
  return <>{children(useUnderBar())}</>;
}

/** A pull-to-refresh control, told where the bar ends (both phones draw the spinner from the very top otherwise). */
export function underRefresh(control: React.ReactElement<RefreshControlProps> | undefined, under: UnderBar) {
  if (!control) return control;
  return React.cloneElement(control, { progressViewOffset: under.refreshOffset });
}

// ---- bringing an opened section up -----------------------------------------------
//
// Open a section near the foot of the screen and what it holds would open
// out of sight. So the page brings it up instead, to one place every time:
// its head just under the bar — or, when the scroll will send the bar away,
// just under the status bar, where the head would otherwise sit below an
// empty band.

const COME_UP_GAP = 12;
/** A little longer than a fold takes to open (Disclosure's 280 ms), so the page moves once everything has settled. */
const COME_UP_AFTER = 300;

const BringUp = createContext<(node: Measurable | null) => void>(() => {});
export const BringUpProvider = BringUp.Provider;

/** For a scrolling page: wire `onScroll` to it, provide `bringUp` (BringUpProvider), and opened sections come up into view. */
export function useBringUpScroll(scrollTo: (y: number) => void) {
  const space = useContext(BarSpace);
  const insets = useSafeAreaInsets();
  const offset = useRef(0);
  // How far the page can scroll at all, so a section near its foot is
  // brought up only as far as the page goes, never past its end.
  const size = useRef({ content: 0, view: 0 });
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; }, []);
  const onContentSizeChange = useCallback((_w: number, h: number) => { size.current.content = h; }, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => { size.current.view = e.nativeEvent.layout.height; }, []);
  const bringUp = useCallback((node: Measurable | null) => {
    node?.measureInWindow((_x, y) => {
      let next = offset.current + y - (space + COME_UP_GAP);
      if (next > CHROME_TOP) next = offset.current + y - (insets.top + COME_UP_GAP);
      const end = size.current.content - size.current.view;
      next = Math.max(0, end > 0 ? Math.min(next, end) : next);
      if (Math.abs(next - offset.current) > 6) scrollTo(next);
    });
  }, [space, insets.top, scrollTo]);
  return { bringUp, onScroll, onContentSizeChange, onLayout };
}

/** On a section that opens: a ref for its outermost view. Each time it opens, the page brings it up. */
export function useComeUp(open: boolean) {
  const bringUp = useContext(BringUp);
  const ref = useRef<View>(null);
  const opened = useRef(open);
  useEffect(() => {
    const was = opened.current;
    opened.current = open;
    if (!open || was) return;
    const id = setTimeout(() => bringUp(ref.current), COME_UP_AFTER);
    return () => clearTimeout(id);
  }, [open, bringUp]);
  return ref;
}
