import React from "react";
import { AppState, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { AppLock } from "@/ui/AppLock";
import { checkBiometric } from "@/auth/biometric";
import { writePrivate } from "@/storage/private";
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "alice" }, signOut: jest.fn() }) }));
jest.mock("@/api/server", () => ({ serverUrl: () => "https://test.example" }));
jest.mock("@/auth/biometric", () => ({ checkBiometric: jest.fn(), biometricKind: jest.fn(async () => "face") }));
jest.mock("@/ui/theme", () => ({ sp: { 2: 8, 4: 16, 6: 24 }, useTheme: () => ({}) }));
jest.mock("@/ui/timesheet", () => ({ Switch: () => null }));
jest.mock("@/ui/confirm", () => ({ notify: jest.fn() }));
jest.mock("@/ui/index", () => ({
  Card: ({ children }: any) => children,
  Button: ({ title, onPress }: any) => { const { Pressable, Text } = require("react-native"); return <Pressable onPress={onPress}><Text>{title}</Text></Pressable>; },
}));
beforeEach(async () => { jest.clearAllMocks(); jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() }); await AsyncStorage.clear(); });
test("enabled app lock blocks content, verifies identity and locks again after backgrounding", async () => {
  await writePrivate("https://test.example|alice", "app-lock", true);
  const events = jest.spyOn(AppState, "addEventListener");
  const screen = await render(<AppLock><Text>Private account content</Text></AppLock>);
  await waitFor(() => expect(screen.queryByText("KaamKoRecord is locked")).not.toBeNull());
  jest.mocked(checkBiometric).mockResolvedValueOnce(false);
  await fireEvent.press(screen.getByText("Unlock"));
  expect(screen.queryByText("KaamKoRecord is locked")).not.toBeNull();
  jest.mocked(checkBiometric).mockResolvedValueOnce(true);
  await fireEvent.press(screen.getByText("Unlock"));
  await waitFor(() => expect(screen.queryByText("KaamKoRecord is locked")).toBeNull());
  const handler = events.mock.calls.find(([event]) => event === "change")![1];
  await act(() => { handler("background"); });
  expect(screen.queryByText("KaamKoRecord is locked")).not.toBeNull();
  await screen.unmount(); events.mockRestore();
});
test("a storage failure requires unlocking instead of exposing account content", async () => {
  jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("Storage unavailable"));
  const screen = await render(<AppLock><Text>Private account content</Text></AppLock>);
  await waitFor(() => expect(screen.queryByText("KaamKoRecord is locked")).not.toBeNull());
  await screen.unmount(); jest.restoreAllMocks();
});
