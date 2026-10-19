import { act, renderHook, waitFor } from "@testing-library/react-native";

import { MIN_SPIN_MS, usePullRefresh } from "@/ui/refresh";

const mockFocus: (() => void)[] = [];
jest.mock("expo-router", () => ({ useFocusEffect: (effect: () => void) => { const { useEffect } = require("react"); useEffect(() => { mockFocus.push(effect); effect(); }, [effect]); } }));

/**
 * The screenshot this was written for: a timesheet full of figures with the
 * pull-down spinner turning above it and everything shoved down the screen,
 * because the app had only been brought back to the front and was checking
 * itself. Nobody had pulled anything.
 */
describe("pull to refresh", () => {
  it("is still until it is pulled", async () => {
    const { result } = await renderHook(() => usePullRefresh(() => Promise.resolve()));
    expect(result.current.props.refreshing).toBe(false);
  });

  it("turns for the pull, and stops when the answer lands", async () => {
    let answer: () => void = () => {};
    const refetch = jest.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    const { result } = await renderHook(() => usePullRefresh(refetch));

    await act(async () => { result.current.props.onRefresh(); });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.props.refreshing).toBe(true);

    await act(async () => { answer(); });
    await waitFor(() => expect(result.current.props.refreshing).toBe(false));
  });

  it("stops for a refetch that failed, rather than turning for ever", async () => {
    const { result } = await renderHook(() => usePullRefresh(() => Promise.reject(new Error("no connection"))));
    await act(async () => { result.current.props.onRefresh(); });
    await waitFor(() => expect(result.current.props.refreshing).toBe(false));
  });

  it("keeps turning for a moment even when the answer is instant, so iOS can finish opening before it closes", async () => {
    jest.useFakeTimers();
    try {
      const { result } = await renderHook(() => usePullRefresh(() => Promise.resolve()));
      await act(async () => { result.current.props.onRefresh(); });
      expect(result.current.props.refreshing).toBe(true);
      await act(async () => { jest.advanceTimersByTime(MIN_SPIN_MS - 100); });
      expect(result.current.props.refreshing).toBe(true);
      await act(async () => { jest.advanceTimersByTime(150); });
      expect(result.current.props.refreshing).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("ignores a second pull while the first is still turning", async () => {
    let answer: () => void = () => {};
    const refetch = jest.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    const { result } = await renderHook(() => usePullRefresh(refetch));
    await act(async () => { result.current.props.onRefresh(); });
    await act(async () => { result.current.props.onRefresh(); });
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => { answer(); });
  });

  it("puts in a fresh control when the screen is shown again, so a stranded spinner cannot survive a page change", async () => {
    const { result } = await renderHook(() => usePullRefresh(() => Promise.resolve()));
    const before = result.current.key;
    await act(async () => { mockFocus.at(-1)!(); });
    expect(result.current.key).not.toBe(before);
    expect(result.current.props.refreshing).toBe(false);
  });
});
