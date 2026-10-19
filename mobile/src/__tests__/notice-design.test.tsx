import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { board, type Notice } from "@/api";
import Home from "../../app/(tabs)/(home)/index";
import Board from "../../app/board";
import { NoticeCard } from "@/ui/NoticeCard";

const mockPush = jest.fn(), mockChanged = jest.fn(), mockFetchNext = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "alice" } }) }));
jest.mock("@/api", () => ({
  useHome: () => ({ data: { notices: mockNotices, notice_total: 4, stories: [], holiday: { holiday: null } }, refetch: jest.fn() }),
  useBoard: () => ({ data: { pages: [{ results: mockNotices, count: 4 }] }, refetch: jest.fn(), hasNextPage: true, fetchNextPage: mockFetchNext }),
  useBoardChanged: () => mockChanged,
  useSafetyChanged: () => jest.fn(),
  board: { edit: jest.fn(), remove: jest.fn(), comment: jest.fn(), pin: jest.fn(), unpin: jest.fn() },
}));
jest.mock("@/ui/index", () => {
  const { View, Pressable } = require("react-native");
  return {
    Screen: ({ children }: any) => <View>{children}</View>,
    Page: ({ children }: any) => <View>{children}</View>,
    Card: ({ children, onPress, accessibilityLabel, ...props }: any) => onPress
      ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}><View {...props}>{children}</View></Pressable>
      : <View {...props}>{children}</View>,
    ErrorBanner: () => null, Empty: () => null, Tally: () => null,
    reactionInk: () => "#000", usePullRefresh: () => undefined,
  };
});
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ desk: false, bottom: 0, column: {} }) }));
jest.mock("@/ui/keyboard", () => ({
  useReveal: () => jest.fn(), useKeyboardScroll: () => ({}), RevealProvider: ({ children }: any) => children,
}));
jest.mock("@/ui/Avatar", () => ({ Avatar: () => null }));
jest.mock("@/ui/AdminBadge", () => ({ AdminBadge: () => null }));
jest.mock("@/ui/VisibilityPicker", () => ({ VisibilityBadge: () => null, VisibilityToggle: () => null }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonHome: () => null, SkeletonNotice: () => null, SkeletonNotices: () => null }));
jest.mock("@/ui/StoriesTray", () => ({ StoriesTray: () => null }));
jest.mock("@/ui/HolidayArt", () => ({ HolidayArt: () => null }));
jest.mock("@/ui/DailyCard", () => ({ DailyPair: () => null, JokeCard: () => null, QuoteCard: () => null }));
jest.mock("@/ui/ReactionPicker", () => ({ ReactionSheet: () => null }));
jest.mock("@/ui/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn(), tap: jest.fn(), success: jest.fn() }));
jest.mock("@/ui/confirm", () => ({ confirm: jest.fn(), notify: jest.fn() }));

const mockNotices: Notice[] = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1, body: `Notice ${index + 1}`, mine: false, is_new: true, visibility: "public", created: "", ago: "1 hour ago", edited: false,
  author: { username: "alice", name: "Alice", initial: "A", hue: 40, photo: null, is_live: false, is_me: true, is_admin: false },
  comments: [], comment_total: 0, older_comments: 0, my_emoji: "", total_reactions: 0, reactions: [], who_reacted: "",
}));
beforeEach(() => jest.clearAllMocks());

test("Home shows two read-only previews, unfolds the rest and opens a conversation natively", async () => {
  const screen = await render(<Home />);
  expect(screen.getAllByText("Open post")).toHaveLength(2);
  expect(screen.queryByPlaceholderText("Write a comment…")).toBeNull();
  expect(screen.queryByText("Notice 3")).toBeNull();
  await fireEvent.press(screen.getByText("Show 2 more notices"));
  expect(screen.getAllByText("Open post")).toHaveLength(4);
  await fireEvent.press(screen.getAllByRole("button", { name: "Open post by alice" })[0]);
  expect(mockPush).toHaveBeenCalledWith("/notices/1");
  await fireEvent.press(screen.getByText("Show fewer"));
  expect(screen.getAllByText("Open post")).toHaveLength(2);
});

test("the full native board folds notices and keeps the Post destination", async () => {
  const screen = await render(<Board />);
  expect(mockFetchNext).not.toHaveBeenCalled();
  expect(screen.queryByText("Notice 3")).toBeNull();
  await fireEvent.press(screen.getByText("Show 2 more notices"));
  expect(screen.getByText("Notice 3")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Post a notice" }));
  expect(mockPush).toHaveBeenCalledWith("/notices/compose");
});

test("Edit is only in the overflow menu and keeps the existing native editor", async () => {
  jest.mocked(board.edit).mockResolvedValue(mockNotices[0]);
  const screen = await render(<NoticeCard notice={{ ...mockNotices[0], mine: true }} full />);
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Notice actions" }));
  await fireEvent.press(screen.getByRole("menuitem", { name: "Edit" }));
  await fireEvent.changeText(screen.getByTestId("notice-editor"), "Updated notice");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(board.edit).toHaveBeenCalledWith(1, "Updated notice", "public"));
  expect(mockChanged).toHaveBeenCalledWith(1);
  expect(screen.queryByTestId("notice-editor")).toBeNull();
});

test("the redesigned reply input still posts inline and clears after success", async () => {
  jest.mocked(board.comment).mockResolvedValue(mockNotices[0]);
  const screen = await render(<NoticeCard notice={mockNotices[0]} full />);
  await fireEvent.changeText(screen.getByPlaceholderText("Write a comment…"), "Thanks for sharing");
  await fireEvent.press(screen.getByLabelText("Send comment"));
  await waitFor(() => expect(board.comment).toHaveBeenCalledWith(1, "Thanks for sharing", undefined, "public"));
  expect(screen.getByPlaceholderText("Write a comment…")).toHaveProp("value", "");
});


test("Delete keeps confirmation and Pin changes to Unpin inside the menu", async () => {
  const { confirm } = require("@/ui/confirm");
  jest.mocked(board.pin).mockResolvedValue({ ...mockNotices[0], pinned: true });
  jest.mocked(board.unpin).mockResolvedValue({ ...mockNotices[0], pinned: false });
  const screen = await render(<NoticeCard notice={{ ...mockNotices[0], mine: true, can_pin: true }} full />);
  expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Notice actions" }));
  await fireEvent.press(screen.getByRole("menuitem", { name: "Delete" }));
  expect(confirm).toHaveBeenCalledWith("Remove this notice?", "Everyone loses sight of it.", "Remove", expect.any(Function));
  expect(board.remove).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Notice actions" }));
  await fireEvent.press(screen.getByRole("menuitem", { name: "Pin" }));
  await waitFor(() => expect(board.pin).toHaveBeenCalledWith(1));
  await fireEvent.press(screen.getByRole("button", { name: "Notice actions" }));
  expect(screen.getByRole("menuitem", { name: "Unpin" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("menuitem", { name: "Unpin" }));
  await waitFor(() => expect(board.unpin).toHaveBeenCalledWith(1));
});

test("other users' menu offers reporting without Edit, Delete or Pin permissions", async () => {
  const screen = await render(<NoticeCard notice={{ ...mockNotices[0], mine: false, can_pin: false }} full />);
  await fireEvent.press(screen.getByRole("button", { name: "Notice actions" }));
  expect(screen.queryByRole("menuitem", { name: /Edit|Delete|Pin/ })).toBeNull();
  expect(screen.getByRole("menuitem", { name: "Report" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Close actions menu" }));
  expect(screen.queryByRole("menuitem", { name: "Report" })).toBeNull();
});
