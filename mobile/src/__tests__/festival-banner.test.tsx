import React from "react";
import { AccessibilityInfo, Animated, AppState } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import type { Festival } from "@/api/types";
import { FestivalBanner } from "@/ui/FestivalBanner";

jest.mock("@/ui/index", () => ({ Card: ({ children }: any) => children }));
jest.mock("@/ui/theme", () => ({ sp: { 2: 8, 4: 16 }, useTheme: () => ({}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: ({ name }: any) => {
  const { Text } = require("react-native");
  return <Text>{name}</Text>;
} }));

const festival: Festival = {
  id: "dashain", name: "Dashain", greeting: "Happy Dashain", description: "Kites and swings",
  motion: "kites", image_url: "https://test.example/dashain.webp",
};

const initialAppState = AppState.currentState;
beforeEach(() => {
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
  jest.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
});
afterEach(() => { AppState.currentState = initialAppState; jest.restoreAllMocks(); });

test("Dashain draws both kites and the swing, and pauses their motion in the background", async () => {
  const animations: { start: jest.Mock; stop: jest.Mock }[] = [];
  const loop = jest.spyOn(Animated, "loop").mockImplementation(() => {
    const animation = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    animations.push(animation);
    return animation;
  });
  const screen = await render(<FestivalBanner festival={festival} />);
  for (const id of ["dashain-red-kite", "dashain-gold-kite", "dashain-swing"]) {
    expect(screen.getByTestId(id, { includeHiddenElements: true })).toBeTruthy();
  }
  expect(screen.queryByText("diamond", { includeHiddenElements: true })).toBeNull();
  await waitFor(() => expect(loop).toHaveBeenCalledTimes(3));
  expect(animations.every(animation => animation.start.mock.calls.length === 1)).toBe(true);
  const change = jest.mocked(AppState.addEventListener).mock.calls[0][1];
  await act(() => { change("background"); });
  expect(animations.every(animation => animation.stop.mock.calls.length === 1)).toBe(true);
  await act(() => { change("active"); });
  expect(loop).toHaveBeenCalledTimes(6);
  await screen.unmount();
});

test("Reduce Motion keeps Dashain artwork visible without starting animations", async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const loop = jest.spyOn(Animated, "loop");
  const screen = await render(<FestivalBanner festival={festival} />);
  expect(screen.getByTestId("dashain-scene", { includeHiddenElements: true })).toBeTruthy();
  expect(loop).not.toHaveBeenCalled();
  await screen.unmount();
});

test("another festival keeps its own effect without Dashain artwork", async () => {
  jest.spyOn(Animated, "loop").mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  const screen = await render(<FestivalBanner festival={{ ...festival, id: "tihar", motion: "lights" }} />);
  await waitFor(() => expect(screen.getAllByText("flame", { includeHiddenElements: true })).toHaveLength(7));
  expect(screen.queryByTestId("dashain-scene", { includeHiddenElements: true })).toBeNull();
  await screen.unmount();
});
