import { Linking, Platform } from "react-native";
import { api } from "@/api/client";
import { ANDROID_STORE, IOS_STORE, openAppStore, validStoreUrl } from "@/nav/stores";
jest.mock("@/api/client", () => ({ api: jest.fn() }));
const platform = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, "OS", { value: platform }); jest.restoreAllMocks(); jest.clearAllMocks(); });
test.each([["android", ANDROID_STORE], ["ios", IOS_STORE]])("%s opens its own store", async (os, url) => {
  Object.defineProperty(Platform, "OS", { value: os });
  jest.mocked(api).mockResolvedValue({ android_url: ANDROID_STORE, ios_url: IOS_STORE });
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await openAppStore();
  expect(open).toHaveBeenCalledWith(url);
});
test("unknown, credential-bearing and different-app store links are rejected", () => {
  expect(validStoreUrl("https://example.com/update", "android")).toBeNull();
  expect(validStoreUrl("https://evil@play.google.com/store/apps/details?id=com.kiranlama.merokaam", "android")).toBeNull();
  expect(validStoreUrl("https://play.google.com/store/apps/details?id=another.app", "android")).toBeNull();
  expect(validStoreUrl("https://apps.apple.com/app/id9999", "ios")).toBeNull();
});
test("a revoked notification tap never opens the store", async () => {
  jest.mocked(api).mockResolvedValue({});
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
  await openAppStore(() => false);
  expect(open).not.toHaveBeenCalled();
});
