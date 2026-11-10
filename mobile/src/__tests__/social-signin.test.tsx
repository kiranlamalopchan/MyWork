import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { SocialSignIn } from "@/ui/SocialSignIn";
import { ApiError } from "@/api/client";

const mockSignIn = jest.fn(), mockWelcome = jest.fn();
let mockProviders: string[] = [];
jest.mock("@/auth/session", () => ({ useSession: () => ({ signInWithSocial: mockSignIn, me: { social_providers: mockProviders } }) }));
jest.mock("@/auth/welcome", () => ({ welcome: (...args: unknown[]) => mockWelcome(...args) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
beforeEach(() => { jest.clearAllMocks(); mockProviders = []; });

test("Google and Apple buttons sign in using the chosen provider", async () => {
  mockSignIn.mockResolvedValue({ username: "signed-in" });
  const page = await render(<SocialSignIn />);
  for (const provider of ["google", "apple"]) {
    await fireEvent.press(page.getByTestId(`social-${provider}`));
    await waitFor(() => expect(mockSignIn).toHaveBeenLastCalledWith(provider, "login"));
  }
  expect(mockWelcome).toHaveBeenCalledTimes(2);
});
test("cancellation stays on the current screen without welcome prompts", async () => {
  mockSignIn.mockResolvedValue(null);
  const page = await render(<SocialSignIn />);
  await fireEvent.press(page.getByTestId("social-google"));
  expect(mockWelcome).not.toHaveBeenCalled();
  expect(page.queryByRole("alert")).toBeNull();
});
test("both buttons stay disabled during a pending browser sign-in", async () => {
  let finish!: (value: null) => void;
  mockSignIn.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const onBusy = jest.fn();
  const page = await render(<SocialSignIn onBusyChange={onBusy} />);
  await fireEvent.press(page.getByTestId("social-google"));
  expect(page.getByTestId("social-google")).toBeDisabled();
  expect(page.getByTestId("social-apple")).toBeDisabled();
  await fireEvent.press(page.getByTestId("social-apple"));
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  await act(async () => finish(null));
  expect(page.getByTestId("social-apple")).toBeEnabled();
  expect(onBusy.mock.calls).toEqual([[true], [false]]);
});
test("failed sign-in shows a friendly message and lets the user retry", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  mockSignIn.mockRejectedValueOnce(new ApiError(400, "We couldn't complete sign-in. Please try again."));
  const page = await render(<SocialSignIn />);
  await fireEvent.press(page.getByTestId("social-google"));
  await waitFor(() => expect(page.getByText("We couldn't complete sign-in. Please try again.")).toBeTruthy());
  expect(page.getByTestId("social-google")).toBeEnabled();
  warn.mockRestore();
});
test("linked accounts are marked while another provider can be connected", async () => {
  mockProviders = ["google"];
  mockSignIn.mockResolvedValue(null);
  const page = await render(<SocialSignIn purpose="link" />);
  expect(page.getByText("Google connected")).toBeTruthy();
  expect(page.getByTestId("social-google")).toBeDisabled();
  await fireEvent.press(page.getByTestId("social-apple"));
  expect(mockSignIn).toHaveBeenCalledWith("apple", "link");
  expect(mockWelcome).not.toHaveBeenCalled();
});
