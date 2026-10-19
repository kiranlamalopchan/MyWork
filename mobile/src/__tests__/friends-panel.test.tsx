import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { FriendsPanel } from "@/ui/FriendsPanel";
import { friends } from "@/api";

const mockChanged = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({
  friends: { remove: jest.fn() },
  useFriendsChanged: () => mockChanged,
  useFriends: () => ({ data: { received: [], sent: [], friends: [{ username: "sam", name: "Sam" }], others: [] } }),
}));
jest.mock("@/ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("@/ui/AdminBadge", () => ({ AdminBadge: () => null }));
jest.mock("@/ui/depth", () => ({ useComeUp: () => null }));
jest.mock("@/ui/haptics", () => ({ warn: jest.fn(), success: jest.fn(), fail: jest.fn(), tick: jest.fn() }));
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
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function openConfirmation() {
  const screen = await render(<FriendsPanel open onToggle={() => {}} />);
  await fireEvent.press(screen.getByRole("button", { name: "Your friends, 1" }));
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
  jest.mocked(friends.remove).mockRejectedValueOnce(new Error("Connection lost."));
  const screen = await openConfirmation();
  const unfriend = jest.mocked(Alert.alert).mock.calls[0][2]!.find(button => button.text === "Unfriend")!;
  await act(() => unfriend.onPress!());
  await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith("That didn't work", "Connection lost."));
  expect(mockChanged).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Remove Sam" })).not.toBeDisabled();
});
