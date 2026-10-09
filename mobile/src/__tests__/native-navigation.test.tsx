import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import TabsLayout from "../../app/(tabs)/_layout";

let mockUnread = 0;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({ useUnread: () => ({ data: { unread: mockUnread } }) }));
jest.mock("@/push/register", () => ({ setBadge: jest.fn() }));
jest.mock("expo-router/unstable-native-tabs", () => {
  const React = require("react");
  const { View, Text } = require("react-native");
  const NativeTabs: any = ({ children }: any) => React.createElement(View, { testID: "native-tabs" }, children);
  NativeTabs.Trigger = function Trigger({ children }: any) { return React.createElement(View, null, children); };
  NativeTabs.Trigger.Label = function Label({ children }: any) { return React.createElement(Text, null, children); };
  NativeTabs.Trigger.Icon = function Icon() { return null; };
  NativeTabs.Trigger.Badge = function Badge({ children }: any) { return React.createElement(Text, { testID: "unread-badge" }, children); };
  return { NativeTabs };
});
jest.mock("expo-router", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Tabs = ({ children }: any) => React.createElement(View, { testID: "browser-tabs" }, children);
  Tabs.Screen = function Screen() { return null; };
  return { Tabs };
});

const originalPlatform = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, "OS", { value: originalPlatform }); });

test.each(["ios", "android"])("%s uses the native navigator and keeps the unread badge", async (platform) => {
  Object.defineProperty(Platform, "OS", { value: platform });
  mockUnread = 120;
  const view = await render(<TabsLayout />);
  expect(view.getByTestId("native-tabs")).toBeTruthy();
  expect(view.queryByTestId("browser-tabs")).toBeNull();
  for (const label of ["Home", "Items", "Work", "Alerts", "Profile"]) expect(view.getByText(label)).toBeTruthy();
  expect(view.getByTestId("unread-badge")).toHaveTextContent("99+");
  mockUnread = 0;
  await view.rerender(<TabsLayout />);
  expect(view.queryByTestId("unread-badge")).toBeNull();
});

test("the browser renderer is used only on web", async () => {
  Object.defineProperty(Platform, "OS", { value: "web" });
  const view = await render(<TabsLayout />);
  expect(view.getByTestId("browser-tabs")).toBeTruthy();
  expect(view.queryByTestId("native-tabs")).toBeNull();
});
