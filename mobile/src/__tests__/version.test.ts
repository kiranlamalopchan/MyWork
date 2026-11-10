import React from "react";
import { render } from "@testing-library/react-native";
import Constants from "expo-constants";
import { appVersion, Version } from "@/ui/Version";

jest.mock("expo-constants", () => ({ __esModule: true, default: { appOwnership: "standalone", executionEnvironment: "standalone", expoConfig: { version: "1.4.0" } } }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.3.0", nativeBuildVersion: "9" }));

test("the profile version line labels the app version number", async () => {
  const view = await render(React.createElement(Version));
  expect(view.getByTestId("app-version").props.children).toBe("Version 1.3.0");
});
test("an installed app reports its binary version and build for problem reports", () => {
  expect(appVersion()).toEqual({ version: "1.3.0", build: "9" });
});
test("Expo Go reports the project version instead of the Expo Go version", () => {
  const original = Constants.appOwnership;
  Object.defineProperty(Constants, "appOwnership", { configurable: true, value: "expo" });
  try { expect(appVersion()).toEqual({ version: "1.4.0", build: "" }); }
  finally { Object.defineProperty(Constants, "appOwnership", { configurable: true, value: original }); }
});
