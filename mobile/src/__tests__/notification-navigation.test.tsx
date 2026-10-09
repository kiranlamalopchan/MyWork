import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationResponse } from "expo-notifications";
import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";

import { api } from "@/api/client";
import { navigateTo } from "@/nav/paths";
import { useNotificationNavigation } from "@/push/useNotificationNavigation";

const mockNotifications = {
  DEFAULT_ACTION_IDENTIFIER: "tap",
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(),
};
const mockBadge = jest.fn(async (_count: number) => {});

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/api/client", () => ({ api: jest.fn() }));
jest.mock("@/push/register", () => ({ notifications: () => mockNotifications, setBadge: (n: number) => mockBadge(n) }));

function response(id = "push-1", url: unknown = "/notifications/123/go/"): NotificationResponse {
  return { actionIdentifier: "tap", notification: { date: 1, request: { identifier: id, trigger: null, content: { title: "Notice", subtitle: null, body: null, sound: null, categoryIdentifier: null, data: { url } } } } };
}

let listener: (response: NotificationResponse) => void;
let remove: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api).mockResolvedValue({ url: "/notices/?notice=12", unread: 2 });
  mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(null);
  remove = jest.fn();
  mockNotifications.addNotificationResponseReceivedListener.mockImplementation((fn) => { listener = fn; return { remove }; });
});

function setup(ready = true, username: string | undefined = "alice") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ ready, username }: { ready: boolean; username: string | undefined }) => useNotificationNavigation(ready, username), { initialProps: { ready, username }, wrapper });
}

test("a go-link is marked read using the app token and opens the native notice", async () => {
  expect(await navigateTo("/notifications/123/go/")).toBe(2);
  expect(api).toHaveBeenCalledWith("notifications/123/read/", { method: "POST" });
  expect(router.push).toHaveBeenCalledWith("/notices/12");
  expect(openBrowserAsync).not.toHaveBeenCalled();
});

test.each(["offline", "deleted", "another account"])("a notification that is %s stays in the native inbox", async () => {
  jest.mocked(api).mockRejectedValueOnce(new Error("unavailable"));
  await navigateTo("/notifications/123/go/");
  expect(router.push).toHaveBeenCalledWith("/notifications");
  expect(openBrowserAsync).not.toHaveBeenCalled();
});

test("unsupported destinations and recursive go-links do not launch the website", async () => {
  for (const url of ["/admin/", "/notifications/123/go/"]) {
    jest.mocked(api).mockResolvedValueOnce({ url, unread: 0 });
    await navigateTo("/notifications/123/go/");
  }
  expect(router.push).toHaveBeenCalledTimes(2);
  expect(router.push).toHaveBeenLastCalledWith("/notifications");
  expect(openBrowserAsync).not.toHaveBeenCalled();
});

test("cold-start taps wait for sign-in and the navigator, then update the badge", async () => {
  mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(response());
  const hook = await setup(false, undefined);
  expect(api).not.toHaveBeenCalled();
  await hook.rerender({ ready: true, username: undefined });
  expect(api).not.toHaveBeenCalled();
  await hook.rerender({ ready: false, username: "alice" });
  expect(api).not.toHaveBeenCalled();
  await hook.rerender({ ready: true, username: "alice" });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/notices/12"));
  expect(mockBadge).toHaveBeenCalledWith(2);
  expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalledTimes(1);
  await hook.unmount();
  expect(remove).toHaveBeenCalled();
});

test("the last response and live listener cannot follow the same tap twice", async () => {
  mockNotifications.getLastNotificationResponseAsync.mockResolvedValue(response());
  const hook = await setup();
  await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  await act(async () => { listener(response()); });
  await hook.rerender({ ready: true, username: "alice" });
  expect(api).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledTimes(1);
  await hook.unmount();
});

test("signing out cancels navigation from a pending tap", async () => {
  let answer: (result: unknown) => void = () => {};
  jest.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
  const hook = await setup();
  await act(async () => { listener(response()); });
  await hook.rerender({ ready: true, username: undefined });
  await act(async () => { answer({ url: "/notices/?notice=12", unread: 0 }); });
  expect(router.push).not.toHaveBeenCalled();
  await hook.unmount();
});

test("a delayed older tap cannot replace the destination of a newer tap", async () => {
  let first: (result: unknown) => void = () => {};
  jest.mocked(api).mockImplementationOnce(() => new Promise((resolve) => { first = resolve; }));
  const hook = await setup();
  await act(async () => { listener(response()); });
  await act(async () => { listener(response("push-2", "/notifications/124/go/")); });
  await waitFor(() => expect(router.push).toHaveBeenCalledWith("/notices/12"));
  await act(async () => { first({ url: "/stories/sam/", unread: 0 }); });
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(openBrowserAsync).not.toHaveBeenCalled();
  await hook.unmount();
});
