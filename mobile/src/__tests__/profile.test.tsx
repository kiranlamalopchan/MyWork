import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import Profile from "@/screens/Profile";
import Settings from "../../app/profile/settings";
import { ProfilePhoto } from "@/ui/ProfilePhoto";
import { me as api, type Me } from "@/api";
const mockPush = jest.fn(), mockSet = jest.fn(), mockSignOut = jest.fn(), mockConfirm = jest.fn(), mockNotify = jest.fn(), mockToggle = jest.fn();
let mockMe: Me;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-reanimated", () => ({ __esModule: true, default: { View: jest.requireActual("react-native").View }, useSharedValue: (value: number) => ({ value }), useAnimatedStyle: () => ({}), withTiming: (value: number) => value, Easing: { out: (value: unknown) => value, cubic: () => {}, bezier: () => (v: number) => v } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: mockMe, setMe: mockSet, signOut: mockSignOut }) }));
jest.mock("@/api", () => ({ me: { setPhoto: jest.fn(), clearPhoto: jest.fn() }, useActivity: () => ({ data: { notice_count: 3, friend_count: 7, shift_count: 1 } }) }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("@/ui/confirm", () => ({ confirm: (...a: unknown[]) => mockConfirm(...a), notify: (...a: unknown[]) => mockNotify(...a) }));
jest.mock("@/ui/theme", () => ({ ...jest.requireActual("@/ui/theme"), useThemeMode: () => ({ isDark: false, toggle: mockToggle }) }));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View, Text } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children }: any) => <View>{children}</View>, Page: ({ children }: any) => <View>{children}</View>, PageTitle: ({ children }: any) => <Text>{children}</Text> };
});
jest.mock("@/ui/PushRow", () => ({ PushRow: () => null }));
jest.mock("@/ui/BiometricRow", () => ({ BiometricRow: () => null }));
jest.mock("@/ui/Version", () => ({ Version: () => null }));
jest.mock("@/ui/FriendsPanel", () => {
  const { Disclosure } = jest.requireActual("@/ui/Disclosure"), { Text } = jest.requireActual("react-native");
  return { FriendsPanel: (p: any) => <Disclosure icon="people-outline" title="Friends" {...p}><Text>Friends content</Text></Disclosure> };
});
jest.mock("@/ui/ProfilePanels", () => {
  const { Disclosure } = jest.requireActual("@/ui/Disclosure"), { Text } = jest.requireActual("react-native");
  return { StatementPanel: (p: any) => <Disclosure icon="document-outline" title="Statement" {...p}><Text>Statement content</Text></Disclosure>, ActivityPanel: (p: any) => <Disclosure icon="pulse-outline" title="Activity" {...p}><Text>Activity content</Text></Disclosure> };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMe = { username: "preview", name: "Profile Preview", initial: "P", hue: 160, photo: null, is_live: false, is_me: true, is_admin: false, display_name: "Profile Preview", email: "", phone: "", address: "", is_staff: false, holiday_state: "NT", since: "Oct 2026" };
  mockSignOut.mockResolvedValue(undefined);
});
test("profile routes editing/settings and keeps closed content out of focus", async () => {
  const s = await render(<Profile tabMode />);
  expect(s.queryByText("Friends content")).toBeNull();
  expect(s.queryByTestId("appearance-toggle")).toBeNull();
  await fireEvent.press(s.getByRole("button", { name: "Edit profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/edit");
  await fireEvent.press(s.getByRole("button", { name: "Settings" }));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/settings");
  await fireEvent.press(s.getByRole("button", { name: "Friends" }));
  expect(s.getByText("Friends content")).toBeTruthy();
  await fireEvent.press(s.getByRole("button", { name: "Statement" }));
  expect(s.queryByText("Friends content")).toBeNull();
  expect(s.getByText("Statement content")).toBeTruthy();
  await fireEvent.press(s.getByRole("button", { name: "Statement" }));
  expect(s.queryByText("Statement content")).toBeNull();
});
test("sign out is confirmed and failure is caught", async () => {
  mockSignOut.mockRejectedValueOnce(new Error("Try again."));
  const s = await render(<Profile />);
  await fireEvent.press(s.getByRole("button", { name: "Sign out" }));
  expect(mockSignOut).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][3]());
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't sign out", "Try again."));
});
test("settings retain their real destinations, appearance and permission gating", async () => {
  const s = await render(<Settings />);
  await fireEvent(s.getByTestId("appearance-toggle"), "valueChange", true);
  expect(mockToggle).toHaveBeenCalled();
  for (const [title, path] of [["Change password", "password"], ["Blocked people", "blocked"], ["Offline shifts", "offline"], ["Report a problem", "report"], ["Delete account", "delete"]]) {
    await fireEvent.press(s.getByRole("button", { name: title }));
    expect(mockPush).toHaveBeenLastCalledWith(`/profile/${path}`);
  }
  mockMe = { ...mockMe, is_staff: true };
  await s.rerender(<Settings />);
  expect(s.queryByTestId("manage-festival-banner")).toBeNull();
  mockMe = { ...mockMe, can_manage_festival: true };
  await s.rerender(<Settings />);
  await fireEvent.press(s.getByTestId("manage-festival-banner"));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/festival");
});
async function choose(s: Awaited<ReturnType<typeof render>>, label: string) {
  await fireEvent.press(s.getByRole("button", { name: "Profile photo actions" }));
  await fireEvent.press(s.getByRole("menuitem", { name: label }));
}
test("cancelled photo selection preserves the saved photo", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Add photo");
  await waitFor(() => expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled());
  expect(api.setPhoto).not.toHaveBeenCalled(); expect(mockSet).not.toHaveBeenCalled();
});
test.each(["picker", "upload"])("%s errors are caught and allow retry", async source => {
  if (source === "picker") jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValueOnce(new Error("Access denied."));
  else {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///photo.jpg", width: 80, height: 80 }] });
    jest.mocked(api.setPhoto).mockRejectedValueOnce(new Error("Upload failed."));
  }
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Add photo");
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't update your photo", source === "picker" ? "Access denied." : "Upload failed."));
  expect(s.getByRole("button", { name: "Profile photo actions" })).not.toBeDisabled();
  expect(mockSet).not.toHaveBeenCalled();
});
test("remove is available, needs confirmation, and catches rejection", async () => {
  mockMe.photo = "https://example.test/photo.jpg";
  jest.mocked(api.clearPhoto).mockRejectedValueOnce(new Error("Connection lost."));
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Remove photo");
  expect(api.clearPhoto).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][3]());
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't update your photo", "Connection lost."));
  expect(mockSet).not.toHaveBeenCalled();
});
test("successful upload uses the saved response and prevents a second operation while busy", async () => {
  const saved = { ...mockMe, photo: "https://example.test/saved.jpg" };
  let finish!: (me: Me) => void;
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///photo.jpg", width: 80, height: 80 }] });
  jest.mocked(api.setPhoto).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Add photo");
  await waitFor(() => expect(api.setPhoto).toHaveBeenCalledTimes(1));
  expect(s.getByRole("button", { name: "Updating your photo" })).toBeDisabled();
  await act(async () => finish(saved));
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith(saved));
});
test("the header's three figures read out and each leads somewhere", async () => {
  const s = await render(<Profile tabMode />);
  await fireEvent.press(s.getByRole("button", { name: "3 posts" }));
  expect(mockPush).toHaveBeenLastCalledWith("/people/preview");
  await fireEvent.press(s.getByRole("button", { name: "1 shift" }));
  expect(mockPush).toHaveBeenLastCalledWith("/work/timesheet");
  expect(s.queryByText("Friends content")).toBeNull();
  await fireEvent.press(s.getByRole("button", { name: "7 friends" }));
  expect(s.getByText("Friends content")).toBeTruthy();
});
