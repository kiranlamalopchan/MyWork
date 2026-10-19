/**
 * Whether the top bar has stepped aside for the page: scroll down and it
 * slides away so the page has the whole screen, and it stays away until the
 * page is scrolled back up to its top. (The tab bar does its own, natively — iOS
 * 26 shrinks it on the same gesture; see app/(tabs)/_layout.tsx.)
 *
 * One flag for the whole app, kept outside React so a page deep inside a tab
 * and its bar read the same thing without a provider around both.
 */
import { useSyncExternalStore } from "react";

let hidden = false;
const listeners = new Set<() => void>();

export function setChromeHidden(next: boolean) {
  if (next === hidden) return;
  hidden = next;
  listeners.forEach((listener) => listener());
}

export function useChromeHidden() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => hidden,
    () => false,
  );
}

/** How far a scroll must keep going one way before the chrome follows it. */
export const CHROME_SLACK = 12;
/** Near the top of a page the chrome always shows. */
export const CHROME_TOP = 64;

/**
 * Feeds one vertical scroll event into the flag. `state` is the caller's own
 * memory of the last offset and the distance travelled the current way.
 */
export function followScroll(state: { y: number; run: number; view?: number }, e: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } }) {
  const end = Math.max(0, e.contentSize.height - e.layoutMeasurement.height);
  // The rubber band at either end moves the offset without anybody asking for
  // the chrome — and springing back from it would read as a scroll the other
  // way. Measured from inside the page's real range, it is no movement at all.
  const y = Math.min(Math.max(e.contentOffset.y, 0), end);
  const delta = y - state.y;
  state.y = y;
  // The page itself changed size — the bars going or coming give it more room
  // or less, and at the foot of the page the offset is pulled back to match.
  // Nobody scrolled; following it would bring the bars straight back.
  const resized = state.view !== undefined && state.view !== e.layoutMeasurement.height;
  state.view = e.layoutMeasurement.height;
  if (delta === 0 || resized) return;
  if (y <= CHROME_TOP) { state.run = 0; setChromeHidden(false); return; }
  // Out of the way for the rest of the page: scrolling back up keeps it
  // hidden until the top, where the line above brings it home.
  state.run = Math.sign(delta) === Math.sign(state.run) ? state.run + delta : delta;
  if (state.run > CHROME_SLACK) setChromeHidden(true);
}
