import { act, renderHook, waitFor } from "@testing-library/react-native";

import { usePullRefresh } from "@/ui/refresh";

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
});
