import { act, renderHook } from "@testing-library/react-native";

import { CHROME_TOP, followScroll, setChromeHidden, useChromeHidden } from "@/ui/chrome";

const at = (y: number, height = 3000, view = 800) => ({ contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: view } });

/** Scrolls a page from where it is to `to`, a few points at a time, as a finger does. */
function scroll(state: { y: number; run: number }, to: number, step = 6) {
  const dir = Math.sign(to - state.y);
  for (let y = state.y + dir * step; dir > 0 ? y < to : y > to; y += dir * step) followScroll(state, at(y));
  followScroll(state, at(to));
}

describe("the chrome steps aside on the way down a page and comes back at the top", () => {
  beforeEach(() => act(() => setChromeHidden(false)));

  it("hides once you have scrolled down past the top, and stays hidden on the way up until the top", async () => {
    const { result } = await renderHook(() => useChromeHidden());
    const state = { y: 0, run: 0 };
    await act(async () => scroll(state, CHROME_TOP - 10));
    expect(result.current).toBe(false);
    await act(async () => scroll(state, 600));
    expect(result.current).toBe(true);
    await act(async () => scroll(state, 300));
    expect(result.current).toBe(true);
    await act(async () => scroll(state, CHROME_TOP + 1));
    expect(result.current).toBe(true);
    await act(async () => scroll(state, 0));
    expect(result.current).toBe(false);
    await act(async () => scroll(state, 900));
    expect(result.current).toBe(true);
  });

  it("does not flicker on a tiny wobble of the finger", async () => {
    const { result } = await renderHook(() => useChromeHidden());
    const state = { y: 0, run: 0 };
    await act(async () => scroll(state, 600));
    expect(result.current).toBe(true);
    await act(async () => { followScroll(state, at(596)); followScroll(state, at(600)); });
    expect(result.current).toBe(true);
  });

  it("always shows near the top of the page", async () => {
    const { result } = await renderHook(() => useChromeHidden());
    const state = { y: 0, run: 0 };
    await act(async () => scroll(state, 600));
    await act(async () => { state.run = 1000; followScroll(state, at(20)); });
    expect(result.current).toBe(false);
  });

  it("ignores the rubber band past the end of the page", async () => {
    const { result } = await renderHook(() => useChromeHidden());
    const state = { y: 0, run: 0 };
    await act(async () => scroll(state, 2200));
    expect(result.current).toBe(true);
    // Overscroll at the bottom (end is 2200), then springing back.
    await act(async () => { followScroll(state, at(2260)); followScroll(state, at(2230)); followScroll(state, at(2200)); });
    expect(result.current).toBe(true);
  });

  it("is not fooled when the page grows into the room the bars leave, at the foot of the page", async () => {
    const { result } = await renderHook(() => useChromeHidden());
    const state = { y: 0, run: 0 };
    await act(async () => scroll(state, 2190));
    expect(result.current).toBe(true);
    // The page is 60 taller now; the offset is pulled back to the new end.
    await act(async () => { followScroll(state, at(2140, 3000, 860)); });
    expect(result.current).toBe(true);
  });
});
