import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { FriendsPage } from "@/ui/FriendsPanel";
import { friends, type Person } from "@/api";

const mockChanged = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockFriends = jest.fn();
jest.mock("@/api", () => ({
  friends: { remove: jest.fn(), page: jest.fn() },
  useFriendsChanged: () => mockChanged,
  useFriends: (...args: unknown[]) => mockFriends(...args),
}));
const person = (username: string) => ({ username, name: username.toUpperCase() }) as unknown as Person;
const oneFriend = { data: { received: [], sent: [], friends: [{ username: "sam", name: "Sam" }], friends_total: 1, others: [], others_total: 0 }, dataUpdatedAt: 1 };
jest.mock("@/ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("@/ui", () => ({ ...jest.requireActual("@/ui"),
  Screen: ({ children }: any) => children,
  Page: ({ children, onScroll }: any) => { const { ScrollView } = require("react-native"); return <ScrollView testID="page" onScroll={onScroll}>{children}</ScrollView>; },
  PageTitle: () => null, usePullRefresh: () => undefined,
}));
jest.mock("@/ui/AdminBadge", () => ({ AdminBadge: () => null }));
jest.mock("@/ui/depth", () => ({ useComeUp: () => null }));
jest.mock("@/ui/haptics", () => ({ warn: jest.fn(), success: jest.fn(), fail: jest.fn(), tick: jest.fn(), tap: jest.fn() }));
jest.mock("@/ui/Disclosure", () => {
  const { View } = require("react-native");
  return {
    Disclosure: ({ children, open }: any) => open ? <View>{children}</View> : null,
    Fold: ({ children, open }: any) => open ? <View>{children}</View> : null,
    FoldChevron: () => null,
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFriends.mockReturnValue(oneFriend);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function openConfirmation() {
  const screen = await render(<FriendsPage />);
  await fireEvent.press(screen.getByRole("button", { name: "Remove Sam" }));
  return screen;
}

test("unfriending requires confirmation and cancellation keeps the friendship", async () => {
  await openConfirmation();
  expect(Alert.alert).toHaveBeenCalledWith("Unfriend Sam?", expect.any(String), [
    { text: "Cancel", style: "cancel" },
    { text: "Unfriend", style: "destructive", onPress: expect.any(Function) },
  ]);
  expect(friends.remove).not.toHaveBeenCalled();
  const cancel = jest.mocked(Alert.alert).mock.calls[0][2]!.find(button => button.text === "Cancel")!;
  await act(() => cancel.onPress?.());
  expect(friends.remove).not.toHaveBeenCalled();
  expect(mockChanged).not.toHaveBeenCalled();
});

test("confirming removes only the chosen friend and disables removal while saving", async () => {
  let finish!: () => void;
  jest.mocked(friends.remove).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(undefined as never); }));
  const screen = await openConfirmation();
  const unfriend = jest.mocked(Alert.alert).mock.calls[0][2]!.find(button => button.text === "Unfriend")!;
  await act(() => unfriend.onPress!());
  expect(friends.remove).toHaveBeenCalledTimes(1);
  expect(friends.remove).toHaveBeenCalledWith("sam");
  expect(screen.getByRole("button", { name: "Remove Sam" })).toBeDisabled();
  expect(mockChanged).not.toHaveBeenCalled();
  await act(() => finish());
  await waitFor(() => expect(mockChanged).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Remove Sam" })).not.toBeDisabled();
});

test("a failed unfriend shows an error and allows retry", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.mocked(friends.remove).mockRejectedValueOnce(new Error("Connection lost."));
  const screen = await openConfirmation();
  const unfriend = jest.mocked(Alert.alert).mock.calls[0][2]!.find(button => button.text === "Unfriend")!;
  await act(() => unfriend.onPress!());
  await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith("That didn't work", "Something went wrong. Please try again."));
  expect(mockChanged).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Remove Sam" })).not.toBeDisabled();
});

const nearBottom = { nativeEvent: { contentOffset: { y: 900 }, layoutMeasurement: { height: 800 }, contentSize: { height: 1800 } } };

test("the first screenful is asked for by size, and scrolling near the end brings the next", async () => {
  const first = Array.from({ length: 3 }, (_, i) => person(`f0${i + 1}`));
  mockFriends.mockReturnValue({ data: { received: [], sent: [], friends: first, friends_total: 5, others: [], others_total: 0 }, dataUpdatedAt: 1 });
  jest.mocked(friends.page).mockResolvedValueOnce({ people: [person("f04"), person("f05")], total: 5, next: null });
  const screen = await render(<FriendsPage />);
  expect(mockFriends).toHaveBeenCalledWith("", expect.any(Number));
  expect(mockFriends.mock.calls[0][1]).toBeGreaterThanOrEqual(8);
  expect(screen.queryByText("F04")).toBeNull();

  await fireEvent.scroll(screen.getByTestId("page"), nearBottom);
  await waitFor(() => expect(screen.getByText("F05")).toBeTruthy());
  expect(friends.page).toHaveBeenCalledWith("friends", 3, expect.any(Number), undefined);

  // All five shown: scrolling again asks for nothing more.
  await fireEvent.scroll(screen.getByTestId("page"), nearBottom);
  expect(friends.page).toHaveBeenCalledTimes(1);
});

test("scrolling far from the end loads nothing", async () => {
  mockFriends.mockReturnValue({ data: { received: [], sent: [], friends: [person("f01")], friends_total: 9, others: [], others_total: 0 }, dataUpdatedAt: 1 });
  const screen = await render(<FriendsPage />);
  await fireEvent.scroll(screen.getByTestId("page"), { nativeEvent: { contentOffset: { y: 0 }, layoutMeasurement: { height: 800 }, contentSize: { height: 4000 } } });
  expect(friends.page).not.toHaveBeenCalled();
});

test("a failed next screenful says so and can be tried again", async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockFriends.mockReturnValue({ data: { received: [], sent: [], friends: [person("f01")], friends_total: 2, others: [], others_total: 0 }, dataUpdatedAt: 1 });
  jest.mocked(friends.page)
    .mockRejectedValueOnce(new Error("Connection lost."))
    .mockResolvedValueOnce({ people: [person("f02")], total: 2, next: null });
  const screen = await render(<FriendsPage />);
  await fireEvent.scroll(screen.getByTestId("page"), nearBottom);
  const retry = await screen.findByTestId("friends-more-retry");
  // While it has failed, scrolling doesn't hammer the server.
  await fireEvent.scroll(screen.getByTestId("page"), nearBottom);
  expect(friends.page).toHaveBeenCalledTimes(1);
  await fireEvent.press(retry);
  await waitFor(() => expect(screen.getByText("F02")).toBeTruthy());
  expect(screen.queryByTestId("friends-more-retry")).toBeNull();
});
