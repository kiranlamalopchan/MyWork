import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Profile from "@/screens/Profile";
import Settings from "../../app/profile/settings";
import Appearance from "../../app/profile/appearance";
import Privacy from "../../app/profile/privacy";
import Help from "../../app/profile/help";
import { ProfilePhoto } from "@/ui/ProfilePhoto";
import { me as api, type Me } from "@/api";
const mockPush = jest.fn(), mockSet = jest.fn(), mockSignOut = jest.fn(), mockConfirm = jest.fn(), mockNotify = jest.fn(), mockChoose = jest.fn(), mockToggle = jest.fn();
let mockMe: Me;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-reanimated", () => ({ __esModule: true, default: { View: jest.requireActual("react-native").View }, useSharedValue: (value: number) => ({ value }), useAnimatedStyle: () => ({}), withTiming: (value: number) => value, Easing: { out: (value: unknown) => value, cubic: () => {}, bezier: () => (v: number) => v } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: mockMe, setMe: mockSet, signOut: mockSignOut }) }));
jest.mock("@/api", () => ({ me: { setPhoto: jest.fn(), clearPhoto: jest.fn() }, useActivity: () => ({ data: { notice_count: 3, friend_count: 2, shift_count: 5 } }) }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(), launchCameraAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn() }));
jest.mock("@/ui/confirm", () => ({ choose: (...a: unknown[]) => mockChoose(...a), confirm: (...a: unknown[]) => mockConfirm(...a), notify: (...a: unknown[]) => mockNotify(...a) }));
jest.mock("@/ui/theme", () => ({ ...jest.requireActual("@/ui/theme"), useThemeMode: () => ({ isDark: false, toggle: mockToggle }) }));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View, Text } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children }: any) => <View>{children}</View>, Page: ({ children }: any) => <View>{children}</View>, PageTitle: ({ children }: any) => <Text>{children}</Text> };
});
jest.mock("@/ui/PushRow", () => ({ PushRow: () => null }));
jest.mock("@/ui/BiometricRow", () => ({ BiometricRow: () => null }));
jest.mock("@/ui/Version", () => ({ Version: () => null }));
beforeEach(() => {
  jest.clearAllMocks();
  mockMe = { username: "preview", name: "Profile Preview", initial: "P", hue: 160, photo: null, is_live: false, is_me: true, is_admin: false, display_name: "Profile Preview", email: "", phone: "", address: "", is_staff: false, holiday_state: "NT", since: "Oct 2026" };
  mockSignOut.mockResolvedValue(undefined);
});
test("profile groups navigate to separate pages instead of expanding content", async () => {
  const s = await render(<Profile tabMode />);
  expect(s.getByText("@preview")).toBeTruthy();
  expect(s.getByText("Member since Oct 2026")).toBeTruthy();
  for (const [label, path] of [["3 posts", "/people/preview"], ["2 friends", "/profile/friends"], ["5 shifts", "/work/timesheet"]]) {
    await fireEvent.press(s.getByRole("button", { name: label }));
    expect(mockPush).toHaveBeenLastCalledWith(path);
  }
  expect(s.queryByText("Friends content")).toBeNull();
  expect(s.queryByTestId("appearance-toggle")).toBeNull();
  await fireEvent.press(s.getByRole("button", { name: "Edit profile" }));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/edit");
  await fireEvent.press(s.getByRole("button", { name: "Settings" }));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/settings");
  for (const [title, path] of [["Friends", "friends"], ["Statement", "statement"], ["Activity", "activity"]]) {
    await fireEvent.press(s.getByRole("button", { name: title }));
    expect(mockPush).toHaveBeenLastCalledWith(`/profile/${path}`);
  }
  expect(s.queryByTestId("friends-page")).toBeNull();
  expect(s.queryByTestId("statement-download")).toBeNull();
});
test("sign out is confirmed and failure is caught", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSignOut.mockRejectedValueOnce(new Error("Try again."));
  const s = await render(<Profile />);
  await fireEvent.press(s.getByRole("button", { name: "Sign out" }));
  expect(mockSignOut).not.toHaveBeenCalled();
  await act(async () => mockConfirm.mock.calls[0][3]());
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't sign out", "Something went wrong. Please try again."));
  warn.mockRestore();
});
test("Settings shows only its destinations and retains administration permission gating", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const settings = () => <QueryClientProvider client={client}><Settings /></QueryClientProvider>;
  const s = await render(settings());
  expect(s.queryByTestId("appearance-toggle")).toBeNull();
  expect(s.queryByTestId("language-select")).toBeNull();
  for (const [title, path] of [["Appearance", "appearance"], ["Notifications", "notifications"], ["Privacy & security", "privacy"], ["Help", "help"]]) {
    await fireEvent.press(s.getByRole("button", { name: title }));
    expect(mockPush).toHaveBeenLastCalledWith(`/profile/${path}`);
  }
  mockMe = { ...mockMe, is_staff: true };
  await s.rerender(settings());
  expect(s.queryByTestId("manage-festival-banner")).toBeNull();
  mockMe = { ...mockMe, can_manage_festival: true };
  await s.rerender(settings());
  await fireEvent.press(s.getByTestId("manage-festival-banner"));
  expect(mockPush).toHaveBeenLastCalledWith("/profile/festival");
});
test("appearance, privacy and help keep their existing controls and destinations", async () => {
  const appearance = await render(<Appearance />);
  await fireEvent(appearance.getByTestId("appearance-toggle"), "valueChange", true);
  expect(mockToggle).toHaveBeenCalled();
  expect(appearance.getByTestId("language-select")).toBeTruthy();
  await appearance.unmount();
  const privacy = await render(<Privacy />);
  for (const [title, path] of [["Change password", "password"], ["Blocked people", "blocked"], ["Delete account", "delete"]]) {
    await fireEvent.press(privacy.getByRole("button", { name: title }));
    expect(mockPush).toHaveBeenLastCalledWith(`/profile/${path}`);
  }
  await privacy.unmount();
  const help = await render(<Help />);
  for (const [title, path] of [["Offline shifts", "offline"], ["Report a problem", "report"]]) {
    await fireEvent.press(help.getByRole("button", { name: title }));
    expect(mockPush).toHaveBeenLastCalledWith(`/profile/${path}`);
  }
});
async function choose(s: Awaited<ReturnType<typeof render>>, label: string) {
  // The choices go to the phone's own sheet; picking one is calling it.
  await fireEvent.press(s.getByRole("button", { name: "Profile photo actions" }));
  const choices: { label: string; onPress: () => void }[] = mockChoose.mock.calls.at(-1)![1];
  await act(async () => choices.find(c => c.label === label)!.onPress());
}
test("the photo opens the phone's own sheet: camera, library, and removal only with a photo up", async () => {
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await fireEvent.press(s.getByRole("button", { name: "Profile photo actions" }));
  expect(mockChoose.mock.calls[0][1].map((c: { label: string }) => c.label)).toEqual(["Take Photo", "Choose from Library"]);
  await s.rerender(<ProfilePhoto me={{ ...mockMe, photo: "https://example.test/photo.jpg" }} onChange={mockSet} />);
  await fireEvent.press(s.getByRole("button", { name: "Profile photo actions" }));
  expect(mockChoose.mock.calls[1][1].map((c: { label: string }) => c.label)).toEqual(["Take Photo", "Choose from Library", "Remove Photo"]);
});
test("the camera asks for permission first, and a refusal is said in words", async () => {
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: false } as ImagePicker.CameraPermissionResponse);
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Take Photo");
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't update your photo", expect.stringContaining("camera isn't allowed")));
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce({ granted: true } as ImagePicker.CameraPermissionResponse);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///shot.jpg", width: 80, height: 80 }] });
  jest.mocked(api.setPhoto).mockResolvedValueOnce({ ...mockMe, photo: "https://example.test/shot.jpg" });
  await choose(s, "Take Photo");
  await waitFor(() => expect(api.setPhoto).toHaveBeenCalledWith({ uri: "file:///shot.jpg", name: "photo.jpg", type: "image/jpeg" }));
});
test("cancelled photo selection preserves the saved photo", async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({ canceled: true, assets: null });
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Choose from Library");
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
  await choose(s, "Choose from Library");
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Couldn't update your photo", source === "picker" ? "Access denied." : "Upload failed."));
  expect(s.getByRole("button", { name: "Profile photo actions" })).not.toBeDisabled();
  expect(mockSet).not.toHaveBeenCalled();
});
test("remove is available, needs confirmation, and catches rejection", async () => {
  mockMe.photo = "https://example.test/photo.jpg";
  jest.mocked(api.clearPhoto).mockRejectedValueOnce(new Error("Connection lost."));
  const s = await render(<ProfilePhoto me={mockMe} onChange={mockSet} />);
  await choose(s, "Remove Photo");
  await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
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
  await choose(s, "Choose from Library");
  await waitFor(() => expect(api.setPhoto).toHaveBeenCalledTimes(1));
  expect(s.getByRole("button", { name: "Updating your photo" })).toBeDisabled();
  await act(async () => finish(saved));
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith(saved));
});
