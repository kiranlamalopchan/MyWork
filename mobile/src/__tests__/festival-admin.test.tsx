import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import FestivalSettingsPage from "../../app/profile/festival";

const mockSave = jest.fn(), mockQuery = jest.fn(), mockSet = jest.fn(), mockInvalidate = jest.fn();
let mockAllowed = true;
const mockTihar = { id: "tihar", name: "Tihar", greeting: "Happy Tihar", description: "Lights and joy", motion: "lights", image_url: "https://site.test/tihar.webp" };
const mockData = { theme: "off", greeting: "", description: "", banner_url: null, preview: null, choices: [
  { value: "auto", label: "Automatic", preview: null }, { value: "off", label: "Off", preview: null }, { value: "tihar", label: "Tihar", preview: mockTihar },
] };
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { username: "admin", can_manage_festival: mockAllowed } }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: (...args: unknown[]) => mockQuery(...args), useQueryClient: () => ({ setQueryData: mockSet, invalidateQueries: mockInvalidate }) }));
jest.mock("@/api/festivals", () => ({ festivals: { settings: jest.fn(), save: (...args: unknown[]) => mockSave(...args) } }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("@/ui/FestivalBanner", () => ({ FestivalBanner: ({ festival }: any) => {
  const { Text } = require("react-native");
  return <Text>{festival.greeting} — {festival.description}</Text>;
} }));
jest.mock("@/ui/Select", () => ({ Select: ({ options, onChange }: any) => {
  const { Text, Pressable, View } = require("react-native");
  return <View>{options.map((o: any) => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => onChange(o.value)}><Text>{o.label}</Text></Pressable>)}</View>;
} }));
jest.mock("@/ui/index", () => {
  const { View, Text, TextInput, Pressable } = require("react-native");
  const Wrapper = ({ children }: any) => <View>{children}</View>;
  return { Screen: Wrapper, Page: Wrapper, Card: Wrapper, Field: Wrapper,
    ErrorBanner: () => <Text>Settings unavailable</Text>, Empty: ({ title }: any) => <Text>{title}</Text>,
    PageTitle: ({ children }: any) => <Text>{children}</Text>, Input: (props: any) => <TextInput {...props} />,
    Button: ({ title, onPress, disabled }: any) => <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
beforeEach(() => {
  jest.clearAllMocks(); mockAllowed = true;
  mockQuery.mockReturnValue({ data: mockData });
  mockInvalidate.mockResolvedValue(undefined);
  mockSave.mockResolvedValue({ ...mockData, theme: "tihar", greeting: "Welcome", description: "Everyone is welcome" });
});

test("regular users cannot load or edit settings even via a direct route", async () => {
  mockAllowed = false;
  const screen = await render(<FestivalSettingsPage />);
  expect(screen.getByText("Administrator access required")).toBeTruthy();
  expect(mockQuery.mock.calls[0][0].enabled).toBe(false);
  expect(screen.queryByLabelText("Save banner")).toBeNull();
  expect(mockSave).not.toHaveBeenCalled();
});

test("selection and custom text preview locally until an explicit save", async () => {
  const screen = await render(<FestivalSettingsPage />);
  await fireEvent.press(screen.getByLabelText("Tihar"));
  await fireEvent.changeText(screen.getByLabelText("Greeting"), "Welcome");
  await fireEvent.changeText(screen.getByLabelText("Description"), "Everyone is welcome");
  expect(screen.getByText("Welcome — Everyone is welcome")).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText("Save banner"));
  await waitFor(() => expect(screen.getByText("Festival banner saved.")).toBeTruthy());
  expect(mockSave).toHaveBeenCalledWith({ theme: "tihar", greeting: "Welcome", description: "Everyone is welcome", remove_banner: false }, undefined);
  expect(mockSet).toHaveBeenCalledWith(["festival-settings", "admin"], expect.objectContaining({ theme: "tihar" }));
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["home"] });
});

test("save failures preserve edits and never report success", async () => {
  mockSave.mockRejectedValueOnce(new Error("Permission denied."));
  const screen = await render(<FestivalSettingsPage />);
  await fireEvent.press(screen.getByLabelText("Tihar"));
  await fireEvent.changeText(screen.getByLabelText("Greeting"), "My greeting");
  await fireEvent.press(screen.getByLabelText("Save banner"));
  await waitFor(() => expect(screen.getByText("Permission denied.")).toBeTruthy());
  expect(screen.getByLabelText("Greeting")).toHaveProp("value", "My greeting");
  expect(screen.queryByText("Festival banner saved.")).toBeNull();
  expect(mockInvalidate).not.toHaveBeenCalled();
});

test("automatic and off explain when no banner appears", async () => {
  const screen = await render(<FestivalSettingsPage />);
  expect(screen.getByText("The festival banner will be hidden.")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Automatic"));
  expect(screen.getByText("No festival banner is scheduled for today.")).toBeTruthy();
  expect(screen.queryByLabelText("Greeting")).toBeNull();
});

test("restoring standard artwork saves removal explicitly", async () => {
  mockQuery.mockReturnValue({ data: { ...mockData, theme: "tihar", banner_url: "https://site.test/custom.png" } });
  const screen = await render(<FestivalSettingsPage />);
  await fireEvent.press(screen.getByLabelText("Use standard artwork"));
  expect(screen.queryByLabelText("Use standard artwork")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Save banner"));
  await waitFor(() => expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ remove_banner: true }), undefined));
});

test("a denied settings response never renders a stale cached editor", async () => {
  mockQuery.mockReturnValue({ data: mockData, error: new Error("Forbidden") });
  const screen = await render(<FestivalSettingsPage />);
  expect(screen.getByText("Settings unavailable")).toBeTruthy();
  expect(screen.queryByLabelText("Save banner")).toBeNull();
});
