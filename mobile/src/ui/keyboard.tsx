/**
 * Keeping what you type above the keyboard. Android draws edge to edge, so
 * the window no longer shrinks for the keyboard on its own; every screen
 * pads its page by the keyboard's height instead (`KeyboardPad`, both
 * platforms), and any box that takes focus asks the page it sits in to
 * scroll it into the clear (`useReveal`), a comment box at the foot of a
 * notice most of all.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { Keyboard, KeyboardAvoidingView, type NativeScrollEvent, type NativeSyntheticEvent, Platform } from "react-native";

/** Something on a page that can be measured on the screen: a View or a TextInput. */
export type Measurable = { measureInWindow(cb: (x: number, y: number, width: number, height: number) => void): void };

const RevealContext = createContext<(node: Measurable | null) => void>(() => {});
export const RevealProvider = RevealContext.Provider;

/** `reveal(node)` from a box's onFocus: the page scrolls until the node clears the keyboard. */
export function useReveal() {
  return useContext(RevealContext);
}

// Daylight between the box and the top of the keyboard.
const GAP = 12;

/**
 * For a scrolling page: wire `onScroll` to the list, `scrollTo` to its
 * scroll method, wrap the page in `<RevealProvider value={reveal}>`, and
 * its inputs stay in view.
 */
export function useKeyboardScroll(scrollTo: (y: number) => void) {
  const offset = useRef(0);
  const wanted = useRef<Measurable | null>(null);
  const keyboardTop = useRef(0);

  const bring = useCallback(() => {
    const node = wanted.current, top = keyboardTop.current;
    if (!node || !top) return;
    node.measureInWindow((_x, y, _w, h) => {
      const over = y + h + GAP - top;
      if (over > 0) scrollTo(offset.current + over);
    });
  }, [scrollTo]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    // "Did" on both: by then the page has been padded and laid out again.
    const show = Keyboard.addListener("keyboardDidShow", (e) => { keyboardTop.current = e.endCoordinates.screenY; setTimeout(bring, 60); });
    const hide = Keyboard.addListener("keyboardDidHide", () => { keyboardTop.current = 0; });
    return () => { show.remove(); hide.remove(); };
  }, [bring]);

  const reveal = useCallback((node: Measurable | null) => {
    wanted.current = node;
    // Keyboard already up (moving from one box to another): straight away.
    if (keyboardTop.current) setTimeout(bring, 60);
  }, [bring]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; }, []);

  return { reveal, onScroll };
}

/** The page shrinks by the keyboard's height, on Android as on iOS. */
export function KeyboardPad({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "web") return <>{children}</>;
  return <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>{children}</KeyboardAvoidingView>;
}
