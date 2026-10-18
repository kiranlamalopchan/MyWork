import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import Search from "../../app/(tabs)/plu/index";
import { useCatalogueSearch } from "@/api/catalogue";

const mockPush = jest.fn(), mockSetParams = jest.fn(), mockReveal = jest.fn();
const mockItem = { id: 42, catalogue_id: 5, title: "BEEF BONELESS SCOTCH FILLET", description: "", code: "123456789012345", fields: {} };
const mockCatalogue = {
  total: 1, samples: [mockItem], catalogue: { id: 5, name: "My private catalogue", code_column: "plu" },
  catalogues: [{ id: 5, name: "My private catalogue", count: 1 }, { id: 8, name: "Another catalogue", count: 2 }],
};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ catalogue: "5" }),
  useRouter: () => ({ push: mockPush, setParams: mockSetParams }),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api/catalogue", () => ({
  useCatalogueIdle: () => ({ data: mockCatalogue }),
  useCatalogueSearch: jest.fn((q: string) => ({ data: { pages: [{ count: q ? 1 : 0, results: q ? [mockItem] : [] }] } })),
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
    Button: ({ title, onPress }: any) => <Pressable onPress={onPress}><Text>{title}</Text></Pressable>,
    Segments: () => null,
  };
});
beforeEach(() => jest.clearAllMocks());

test("search updates the selected catalogue's results and clears back to browsing", async () => {
  const screen = await render(<Search />);
  await fireEvent.changeText(screen.getByTestId("plu-q"), "beef");
  await waitFor(() => expect(useCatalogueSearch).toHaveBeenLastCalledWith("beef", 5));
  expect(screen.getByText("1 result for “beef”")).toBeTruthy();
  expect(screen.getByTestId("plu-q")).toHaveProp("value", "beef");
  await fireEvent.press(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByTestId("plu-q")).toHaveProp("value", "");
  expect(screen.getByText("Browse a few items")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("search-catalogue"));
  expect(mockSetParams).toHaveBeenCalledWith({ catalogue: "8" });
});

test("the separate favourite target saves an item without opening it", async () => {
  const screen = await render(<Search />);
  await fireEvent.press(screen.getByRole("button", { name: "Save favourite" }));
  expect(screen.getByRole("button", { name: "Remove favourite" })).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: `Open ${mockItem.title}` }));
  expect(mockPush).toHaveBeenCalledWith("/plu/42");
});

test("photo search and upload remain reachable from the redesigned actions", async () => {
  const screen = await render(<Search />);
  await fireEvent.press(screen.getByRole("button", { name: "Photo search" }));
  expect(screen.getByText("Photo search content")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Back to search" }));
  expect(screen.getByTestId("plu-q")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Upload catalogue" }));
  expect(mockPush).toHaveBeenCalledWith("/items/import");
});
