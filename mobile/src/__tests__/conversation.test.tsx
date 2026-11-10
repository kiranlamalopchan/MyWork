import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import Conversation from "../../app/messages/[username]";

const mockSend = jest.fn(), mockThread = jest.fn(), mockChanged = jest.fn();
const mockQuery = { data: { person: { username: "sam", name: "Sam" }, messages: [], more: false, can_send: true, max_length: 2000 }, isLoading: false, error: null, refetch: jest.fn() };
jest.mock("@/api", () => ({ chat: { send: (...args: unknown[]) => mockSend(...args), thread: (...args: unknown[]) => mockThread(...args) }, useChatThread: () => mockQuery, useChatChanged: () => mockChanged }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ username: "sam" }), useRouter: () => ({ push: jest.fn() }), useFocusEffect: (callback: any) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/ui", () => ({ Screen: ({ children }: any) => children, Avatar: () => null, Empty: () => null, ErrorBanner: () => null }));
jest.mock("@/ui/depth", () => ({ WithDepth: ({ children }: any) => children({ scroll: {}, padTop: 0 }) }));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, insets: { bottom: 0 } }) }));
jest.mock("@/ui/haptics", () => ({ fail: jest.fn(), tap: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); });

test("a failed send preserves the draft and shows guidance instead of technical details", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSend.mockRejectedValueOnce(new TypeError("InternalSession.swift:88"));
  const view = await render(<Conversation />);
  await fireEvent.changeText(view.getByTestId("chat-input"), "Cover Saturday?");
  await fireEvent.press(view.getByTestId("chat-send"));
  await waitFor(() => expect(view.getByText("Something went wrong. Please try again.")).toBeTruthy());
  expect(view.getByTestId("chat-input").props.value).toBe("Cover Saturday?");
  expect(view.queryByText("InternalSession.swift:88")).toBeNull();
  expect(view.getByTestId("chat-send")).not.toBeDisabled();
  warn.mockRestore();
});

test("a pending send prevents duplicates and only clears the draft after success", async () => {
  let finish!: (value: unknown) => void;
  mockSend.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = await render(<Conversation />);
  await fireEvent.changeText(view.getByTestId("chat-input"), "Hi Sam");
  await fireEvent.press(view.getByTestId("chat-send"));
  expect(view.getByTestId("chat-send")).toBeDisabled();
  expect(view.getByTestId("chat-input").props.value).toBe("Hi Sam");
  expect(view.getByTestId("chat-input").props.editable).toBe(false);
  await fireEvent.press(view.getByTestId("chat-send"));
  expect(mockSend).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ id: 1, body: "Hi Sam", mine: true, at: "2026-11-10T00:00:00Z", day: "Today", time: "9:30 am", read: false }); });
  await waitFor(() => expect(view.getByTestId("chat-input").props.value).toBe(""));
  expect(view.getByText("Hi Sam")).toBeTruthy();
});
