import { act, renderHook, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { readPrivate, writePrivate, usePrivateState } from "@/storage/private";
let mockUsername = "alice";
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: mockUsername } }) }));
jest.mock("@/api/server", () => ({ serverUrl: () => "https://test.example" }));
beforeEach(async () => { mockUsername = "alice"; await AsyncStorage.clear(); });

test("private storage partitions records by account and server", async () => {
  await writePrivate("server|alice", "draft", { note: "Alice only" });
  expect(await readPrivate("server|bob", "draft", null)).toBeNull();
  expect(await readPrivate("other-server|alice", "draft", null)).toBeNull();
  expect(await readPrivate("server|alice", "draft", null)).toEqual({ note: "Alice only" });
});
test("a saved draft restores after unmount and does not leak on account change", async () => {
  const first = await renderHook(() => usePrivateState("notice", ""));
  await waitFor(() => expect(first.result.current[2]).toBe(true));
  await act(async () => { first.result.current[1]("unfinished notice"); });
  await first.unmount();
  const second = await renderHook(() => usePrivateState("notice", ""));
  await waitFor(() => expect(second.result.current[0]).toBe("unfinished notice"));
  mockUsername = "bob";
  await second.rerender({});
  await waitFor(() => expect(second.result.current[2]).toBe(true));
  expect(second.result.current[0]).toBe("");
  await second.unmount();
});
test("rapid saves keep the last value", async () => {
  await Promise.all([writePrivate("alice", "draft", "one"), writePrivate("alice", "draft", "two")]);
  expect(await readPrivate("alice", "draft", "")).toBe("two");
});
