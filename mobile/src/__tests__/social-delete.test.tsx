import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import DeleteAccount from "../../app/profile/delete";

const mockAuthenticate = jest.fn(), mockDelete = jest.fn(), mockSignOut = jest.fn();
jest.mock("@/auth/social", () => ({ authenticateWithProvider: (...args: unknown[]) => mockAuthenticate(...args) }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ me: { has_password: false, social_providers: ["apple"] }, signOut: mockSignOut }) }));
jest.mock("@/api", () => ({ me: { deleteAccount: (...args: unknown[]) => mockDelete(...args) } }));
jest.mock("@/ui/haptics", () => ({ warn: jest.fn(), fail: jest.fn(), tap: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View, Text } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children }: any) => <View>{children}</View>, Page: ({ children }: any) => <View>{children}</View>, PageTitle: ({ children }: any) => <Text>{children}</Text> };
});
beforeEach(() => { jest.clearAllMocks(); mockDelete.mockResolvedValue(undefined); mockSignOut.mockResolvedValue(undefined); });
test("social accounts can delete after provider verification without a password", async () => {
  mockAuthenticate.mockResolvedValue({ reauth_token: "short-lived-proof" });
  const page = await render(<DeleteAccount />);
  expect(page.queryByTestId("delete-password")).toBeNull();
  await fireEvent.press(page.getByTestId("delete-apple"));
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("", "short-lived-proof"));
  expect(mockAuthenticate).toHaveBeenCalledWith("apple", "reauth");
  expect(mockSignOut).toHaveBeenCalled();
});
test("cancelling provider verification does not delete anything", async () => {
  mockAuthenticate.mockResolvedValue(null);
  const page = await render(<DeleteAccount />);
  await fireEvent.press(page.getByTestId("delete-apple"));
  expect(mockDelete).not.toHaveBeenCalled();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(page.getByTestId("delete-apple")).toBeEnabled();
});
