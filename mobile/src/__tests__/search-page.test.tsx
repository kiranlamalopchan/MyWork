import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import Search from "../../app/(tabs)/plu/index";
import { useCatalogueSearch } from "@/api/catalogue";

const mockPush = jest.fn(), mockSetParams = jest.fn(), mockReveal = jest.fn();
const mockParams: { catalogue: string; view?: string } = { catalogue: "5" };
const mockCopy = jest.fn().mockResolvedValue(true);
const mockRemove = jest.fn().mockResolvedValue(undefined), mockReplace = jest.fn();
const mockConfirm = jest.fn(), mockChanged = jest.fn();
jest.mock("@/ui/confirm", () => ({ confirm: (...args: unknown[]) => mockConfirm(...args) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: (...args: unknown[]) => mockCopy(...args) }));
const mockItem = { id: 42, catalogue_id: 5, title: "BEEF BONELESS SCOTCH FILLET", description: "Fresh beef fillet", code: "123456789012345", fields: {} };
const mockCatalogue = {
  total: 1, samples: [mockItem], catalogue: { id: 5, name: "My private catalogue", code_column: "plu" },
  catalogues: [{ id: 5, name: "My private catalogue", count: 1 }, { id: 8, name: "Another catalogue", count: 2 }],
};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, setParams: mockSetParams, replace: mockReplace }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api/catalogue", () => ({
  useCatalogueIdle: () => ({ data: mockCatalogue }),
  useCatalogueChanged: () => mockChanged,
  catalogue: { remove: (...args: unknown[]) => mockRemove(...args) },
  useCatalogueSearch: jest.fn(),
}));
jest.mock("@/storage/private", () => ({ usePrivateState: (_key: string, initial: unknown) => [...require("react").useState(initial), true] }));
jest.mock("@/ui/layout", () => ({ useLayout: () => ({ column: {}, bottom: 0 }) }));
jest.mock("@/ui/keyboard", () => ({
  RevealProvider: ({ children }: any) => children,
  useKeyboardScroll: () => ({ reveal: mockReveal, onScroll: jest.fn() }),
}));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn() }));
jest.mock("@/ui/SavedProducts", () => ({ SavedProducts: () => null }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("@/ui/TypedPlaceholder", () => ({ TypedPlaceholder: ({ phrases, show }: any) => {
  const { Text } = require("react-native");
  return show ? <Text testID="typed-placeholder">{phrases.join(" | ")}</Text> : null;
} }));
jest.mock("@/ui/PhotoSearch", () => ({ PhotoSearch: () => { const { Text } = require("react-native"); return <Text>Photo search content</Text>; } }));
jest.mock("@/ui/Select", () => ({ Select: ({ onChange, testID }: any) => {
  const { Pressable, Text } = require("react-native");
  return <Pressable testID={testID} onPress={() => onChange("8")}><Text>Choose catalogue</Text></Pressable>;
} }));
jest.mock("@/ui/index", () => {
  const { View, Text, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return {
    Screen: Wrapper, Card: Wrapper, Page: Wrapper, ErrorBanner: () => null, Empty: () => null,
    PageTitle: ({ children }: any) => <Text>{children}</Text>,
    Button: ({ title, onPress, accessibilityLabel, disabled }: any) => <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} disabled={disabled} onPress={onPress}><Text>{title}</Text></Pressable>,
    Segments: () => null,
  };
});
beforeEach(() => {
  jest.clearAllMocks(); delete mockParams.view;
  (useCatalogueSearch as jest.Mock).mockImplementation((q: string) => ({ data: { count: q ? 1 : 0, page: 1, pages: 1, next: null, results: q ? [mockItem] : [] } }));
});

test("search stays clear until a query and clears its results when the query is removed", async () => {
  const screen = await render(<Search />);
  expect(screen.queryByText(mockItem.description)).toBeNull();
  expect(screen.queryByText("From your catalogue")).toBeNull();
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  await waitFor(() => expect(useCatalogueSearch).toHaveBeenLastCalledWith("beef", 5, 1));
  expect(screen.getByText("1 result for “beef”")).toBeTruthy();
  expect(screen.getByTestId("plu-q")).toHaveProp("value", "beef");
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByTestId("plu-q")).toHaveProp("value", "");
  expect(screen.queryByText(mockItem.description)).toBeNull();
  expect(screen.queryByText("Results")).toBeNull();
  await fireEvent.press(screen.getByTestId("search-catalogue"));
  expect(mockSetParams).toHaveBeenCalledWith({ catalogue: "8" });
});

test("results show only number and description without copy, favourite or open controls", async () => {
  const screen = await render(<Search />);
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  await waitFor(() => expect(screen.getByText(mockItem.description)).toBeTruthy());
  expect(screen.getByText(mockItem.code)).toBeTruthy();
  expect(screen.queryByText(mockItem.title)).toBeNull();
  expect(screen.queryByRole("button", { name: /Copy code|favourite|Open BEEF/ })).toBeNull();
  expect(screen.queryByText("Tap a code to copy")).toBeNull();
});

test("search keeps photo search without a duplicate upload action", async () => {
  const screen = await render(<Search />);
  expect(screen.queryByTestId("plu-import")).toBeNull();
  expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Photo search" }));
  expect(screen.getByText("Photo search content")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Back to search" }));
  expect(screen.getByTestId("plu-q")).toBeTruthy();
});

test("catalogue uploads remain available from the Catalogues tab", async () => {
  mockParams.view = "catalogues";
  const screen = await render(<Search />);
  await fireEvent.press(screen.getByText("Upload a new catalogue"));
  expect(mockPush).toHaveBeenCalledWith("/items/import");
  expect(screen.queryByRole("button", { name: /Search My private catalogue/ })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "Edit My private catalogue" })).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: "Actions for My private catalogue" }));
  await fireEvent.press(screen.getByRole("menuitem", { name: "Edit My private catalogue" }));
  expect(mockPush).toHaveBeenCalledWith("/items/catalogue/5");
});

test("deleting a catalogue asks first and refreshes management after confirmation", async () => {
  mockParams.view = "catalogues";
  const screen = await render(<Search />);
  await fireEvent.press(screen.getByRole("button", { name: "Actions for My private catalogue" }));
  await fireEvent.press(screen.getByRole("menuitem", { name: "Delete My private catalogue" }));
  expect(mockConfirm).toHaveBeenCalledWith("Delete My private catalogue?", expect.stringContaining("1 item"), "Delete", expect.any(Function));
  expect(mockRemove).not.toHaveBeenCalled();
  await act(async () => { await mockConfirm.mock.calls[0][3](); });
  expect(mockRemove).toHaveBeenCalledWith(5);
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/plu", params: { view: "catalogues" } });
  expect(mockChanged).toHaveBeenCalled();
});

test("catalogue actions can be dismissed without editing or deleting", async () => {
  mockParams.view = "catalogues";
  const screen = await render(<Search />);
  await fireEvent.press(screen.getByRole("button", { name: "Actions for My private catalogue" }));
  expect(screen.getByRole("menuitem", { name: "Edit My private catalogue" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Close actions menu" }));
  expect(screen.queryByRole("menuitem", { name: "Edit My private catalogue" })).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockConfirm).not.toHaveBeenCalled();
});

test("pagination replaces five results at a time and a changed query resets to page one", async () => {
  (useCatalogueSearch as jest.Mock).mockImplementation((q: string, _id: number, page: number) => ({ data: {
    count: 11, page, pages: 3, next: page < 3 ? page + 1 : null,
    results: q ? Array.from({ length: page === 3 ? 1 : 5 }, (_, i) => ({ ...mockItem, id: (page - 1) * 5 + i, code: String((page - 1) * 5 + i), description: `Match ${(page - 1) * 5 + i}` })) : [],
  } }));
  const screen = await render(<Search />);
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  await waitFor(() => expect(screen.getByText("Page 1 of 3")).toBeTruthy());
  expect(screen.getAllByText(/^Match /)).toHaveLength(5);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  expect(screen.queryByText("Match 0")).toBeNull();
  expect(screen.getAllByText(/^Match /)).toHaveLength(5);
  await fireEvent.press(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  expect(screen.getAllByText(/^Match /)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Previous" }));
  expect(screen.getByText("Page 2 of 3")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("plu-q"), "apple");
  await waitFor(() => expect(useCatalogueSearch).toHaveBeenLastCalledWith("apple", 5, 1));
  expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  await waitFor(() => expect(useCatalogueSearch).toHaveBeenLastCalledWith("beef", 5, 1));
});

test("the box types real examples from the catalogue until it is focused or typed in", async () => {
  const screen = await render(<Search />);
  expect(screen.getByTestId("typed-placeholder")).toHaveTextContent("Beef boneless scotch | 123456789012345");
  await fireEvent(screen.getByTestId("plu-q"), "focus");
  expect(screen.queryByTestId("typed-placeholder")).toBeNull();
  await fireEvent(screen.getByTestId("plu-q"), "blur");
  expect(screen.getByTestId("typed-placeholder")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  expect(screen.queryByTestId("typed-placeholder")).toBeNull();
});
