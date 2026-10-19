import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import ForgotPassword from "../../app/(auth)/forgot-password";
import Login from "../../app/(auth)/login";
import { auth } from "@/api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({ auth: { requestPasswordReset: jest.fn() } }));
jest.mock("@/auth/session", () => ({ useSession: () => ({ signIn: jest.fn(), signInWithToken: jest.fn() }) }));
jest.mock("@/auth/welcome", () => ({ welcome: jest.fn() }));
jest.mock("@/auth/biometric", () => ({ biometricKind: async () => null, biometricUser: async () => null }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn(), tap: jest.fn(), success: jest.fn(), fail: jest.fn() }));
jest.mock("@/ui/AuthFrame", () => {
  const { View, Text } = require("react-native");
  return { AuthFrame: ({ title, sub, children, link }: any) => <View><Text>{title}</Text><Text>{sub}</Text>{children}<Text>{link}</Text></View> };
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(auth.requestPasswordReset).mockResolvedValue({ detail: "If an account uses that email, a password reset link will arrive shortly." });
});

test("Forgot password is directly available from sign-in", async () => {
  const screen = await render(<Login />);
  await fireEvent.press(screen.getByRole("link", { name: "Forgot password?" }));
  expect(mockPush).toHaveBeenCalledWith("/(auth)/forgot-password");
});

test("a reset request trims the email and shows a generic inbox confirmation", async () => {
  const screen = await render(<ForgotPassword />);
  expect(screen.getByTestId("request-reset")).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId("reset-email"), " user@example.com ");
  await fireEvent.press(screen.getByTestId("request-reset"));
  await waitFor(() => expect(screen.getByText("Check your email")).toBeTruthy());
  expect(auth.requestPasswordReset).toHaveBeenCalledWith("user@example.com");
  expect(screen.getByText(/If an account uses that email/)).toBeTruthy();
  expect(screen.getByText("Back to sign in")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Try another email"));
  expect(screen.getByTestId("reset-email")).toHaveProp("value", " user@example.com ");
});

test("a request in progress cannot be submitted twice", async () => {
  let finish!: () => void;
  jest.mocked(auth.requestPasswordReset).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ detail: "Check email" }); }));
  const screen = await render(<ForgotPassword />);
  await fireEvent.changeText(screen.getByTestId("reset-email"), "user@example.com");
  await act(() => {
    screen.getByTestId("reset-email").props.onSubmitEditing();
    screen.getByTestId("reset-email").props.onSubmitEditing();
  });
  expect(auth.requestPasswordReset).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("reset-email")).toHaveProp("editable", false);
  expect(screen.getByTestId("request-reset")).toBeDisabled();
  await act(() => finish());
});

test("email validation errors stay beside the field and allow correction", async () => {
  jest.mocked(auth.requestPasswordReset).mockRejectedValueOnce({ message: "Invalid email", fields: { email: ["Enter a valid email address."] } });
  const screen = await render(<ForgotPassword />);
  await fireEvent.changeText(screen.getByTestId("reset-email"), "wrong");
  await fireEvent.press(screen.getByTestId("request-reset"));
  await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeTruthy());
  expect(screen.queryByText("Check your email")).toBeNull();
  await fireEvent.changeText(screen.getByTestId("reset-email"), "user@example.com");
  await fireEvent.press(screen.getByTestId("request-reset"));
  await waitFor(() => expect(screen.getByText("Check your email")).toBeTruthy());
});

test("unavailable delivery is explained without claiming a link was sent", async () => {
  jest.mocked(auth.requestPasswordReset).mockRejectedValueOnce(new Error("Email reset is not available yet. Please ask an admin for a reset link."));
  const screen = await render(<ForgotPassword />);
  await fireEvent.changeText(screen.getByTestId("reset-email"), "user@example.com");
  await fireEvent.press(screen.getByTestId("request-reset"));
  await waitFor(() => expect(screen.getByText(/Email reset is not available yet/)).toBeTruthy());
  expect(screen.queryByText("Check your email")).toBeNull();
  expect(screen.getByTestId("request-reset")).not.toBeDisabled();
});
