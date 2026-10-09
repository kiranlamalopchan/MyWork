import React from "react";
import { StyleSheet } from "react-native";
import { render, waitFor } from "@testing-library/react-native";
import Inbox from "../screens/Inbox";

let mockFocused = true;
const mockReadAll = jest.fn(async () => {});
const mockChanged = jest.fn();
const mockQuery = {
  data: { pages: [{ unread: 1, results: [{ id: 1, kind: "notice", title: "A new notice", body: "", created: "2026-10-09T10:00:00Z", read: false, actor: null, ago: "just now" }] }] },
  isLoading: false, error: null, refetch: jest.fn(), hasNextPage: false, isFetchingNextPage: false, fetchNextPage: jest.fn(),
};
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({ inbox: { readAll: () => mockReadAll() }, useInbox: () => mockQuery, useInboxChanged: () => mockChanged }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: any) => { require("react").useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]); },
}));
jest.mock("@/nav/paths", () => ({ navigateTo: jest.fn() }));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, bottom: 0 }) }));
jest.mock("@/ui", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const Wrapper = ({ children }: any) => React.createElement(View, null, children);
  return { Screen: Wrapper, Card: Wrapper, Avatar: () => null, Button: () => null, Empty: () => null, ErrorBanner: () => null, PageTitle: ({ children }: any) => React.createElement(Text, null, children), usePullRefresh: () => undefined };
});
jest.mock("@/ui/Skeleton", () => ({ SkeletonNotifications: () => null }));

test("marking the native inbox read keeps unread rows highlighted for that visit", async () => {
  const view = await render(<Inbox />);
  await waitFor(() => expect(mockReadAll).toHaveBeenCalledTimes(1));
  mockQuery.data = { pages: [{ unread: 0, results: mockQuery.data.pages[0].results.map((note) => ({ ...note, read: true })) }] };
  await view.rerender(<Inbox />);
  await view.rerender(<Inbox />);
  expect(StyleSheet.flatten(view.getByText("A new notice").props.style).fontWeight).toBe("800");
  mockFocused = false;
  await view.rerender(<Inbox />);
  mockFocused = true;
  await view.rerender(<Inbox />);
  expect(StyleSheet.flatten(view.getByText("A new notice").props.style).fontWeight).toBe("600");
  expect(mockReadAll).toHaveBeenCalledTimes(1);
});
