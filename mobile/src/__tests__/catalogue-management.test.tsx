import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import ManageCatalogue from "../../app/items/catalogue/[id]";

const mockPush = jest.fn(), mockReplace = jest.fn(), mockChanged = jest.fn();
const mockUpdate = jest.fn(), mockDelete = jest.fn();
const mockDetails = { id: 5, name: "Work kit", count: 2, headers: ["Code", "Name", "Notes"], search_columns: ["Code", "Name"], title_column: "Name", code_column: "Code", description_column: "Notes" };
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "5" }), useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "owner" } }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: mockDetails }) }));
jest.mock("@/api/catalogue", () => ({ catalogue: { update: (...args: unknown[]) => mockUpdate(...args) }, useCatalogueChanged: () => mockChanged }));
jest.mock("@/ui/useDeleteCatalogue", () => ({ useDeleteCatalogue: () => ({ remove: mockDelete, busyId: null, error: "" }) }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("@/ui/index", () => {
  const { View, Text, TextInput, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, Field: Wrapper, ErrorBanner: () => null,
    PageTitle: ({ children }: any) => <Text>{children}</Text>,
    Input: (props: any) => <TextInput {...props} />,
    Button: ({ title, onPress, disabled }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}><Text>{title}</Text></Pressable>,
    Chip: ({ children, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={children} onPress={onPress}><Text>{children}</Text></Pressable>,
  };
});
beforeEach(() => { jest.clearAllMocks(); mockUpdate.mockResolvedValue(mockDetails); });

test("edits a catalogue's name and searchable columns, then returns to management", async () => {
  const screen = await render(<ManageCatalogue />);
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), "New kit");
  await fireEvent.press(screen.getByRole("button", { name: "Notes" }));
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(5, { name: "New kit", search_columns: ["Code", "Name", "Notes"] }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: "/plu", params: { view: "catalogues" } });
  expect(mockChanged).toHaveBeenCalled();
});

test("save errors keep edits on screen and prevent navigating away", async () => {
  mockUpdate.mockRejectedValueOnce(new Error("That name already exists."));
  const screen = await render(<ManageCatalogue />);
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), "Taken");
  await fireEvent.press(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(screen.getByText("That name already exists.")).toBeTruthy());
  expect(screen.getByLabelText("Catalogue name")).toHaveProp("value", "Taken");
  expect(mockReplace).not.toHaveBeenCalled();
});

test("replacement targets this catalogue and deletion uses the confirmed delete flow", async () => {
  const screen = await render(<ManageCatalogue />);
  await fireEvent.press(screen.getByRole("button", { name: "Replace CSV" }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/items/import", params: { catalogue: "5" } });
  await fireEvent.press(screen.getByRole("button", { name: "Delete catalogue" }));
  expect(mockDelete).toHaveBeenCalledWith(5, "Work kit", 2);
});

test("cannot save an empty name or a catalogue without searchable columns", async () => {
  const screen = await render(<ManageCatalogue />);
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), " ");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Catalogue name"), "Work kit");
  await fireEvent.press(screen.getByRole("button", { name: "Code" }));
  await fireEvent.press(screen.getByRole("button", { name: "Name" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(mockUpdate).not.toHaveBeenCalled();
});
