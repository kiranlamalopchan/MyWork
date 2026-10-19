import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import Pay from "@/screens/Pay";
import { timesheet } from "@/api";

const mockPush = jest.fn(), mockChanged = jest.fn(), mockConfirm = jest.fn(), mockNotify = jest.fn(), mockTell = jest.fn();
const duration = (hours: number) => ({ seconds: hours * 3600, hm: `${hours}h`, hours });
const run = (hours: number) => ({ start: "2026-10-04", end: "2026-10-11", dates: "4–10 Oct", payday: "11 Oct", hours, worked: duration(hours), shifts: 1, pay: { gross: hours * 25, tax: 0, net: hours * 25 }, payable: true, closed: true });
const mockRows = [
  { workplace: { id: 1, name: "Harbour Market", hue: 165, css: "hsl(165 62% 50%)", is_default: true }, cycle_label: "weekly", period_label: "week", scheduled: true, worked: duration(8), shifts: 2, owed_pay: { gross: 200, tax: 20, net: 180 }, since: "1 Oct", earliest: "2026-10-04", current: null, due: [run(8)], covers: [{ value: "2026-10-11", label: "4–10 Oct" }], last_payment: { covers_through: "1 Oct", hours: 7, amount: 175 } },
  { workplace: { id: 2, name: "City Cafe", hue: 210, css: "hsl(210 62% 50%)", is_default: false }, cycle_label: "irregular", period_label: "period", scheduled: false, worked: duration(3), shifts: 1, owed_pay: null, since: null, earliest: "2026-10-10", current: { ...run(3), pay: null, dates: null, payday: null }, due: [], covers: [{ value: "now", label: "Everything up to now" }], last_payment: null },
];
let mockData: any;
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({ usePay: () => ({ data: mockData }), useTimesheetChanged: () => mockChanged, timesheet: { recordPayment: jest.fn(), undoPayment: jest.fn() } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/ui/WorkPage", () => ({ WorkPage: ({ children }: any) => children }));
jest.mock("@/ui/WorkNavigation", () => ({ WorkNavigation: () => null }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonPay: () => null }));
jest.mock("@/ui/confirm", () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), notify: (...args: unknown[]) => mockNotify(...args), tell: (...args: unknown[]) => mockTell(...args) }));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn() }));
jest.mock("@/ui/useReducedMotion", () => ({ useReducedMotion: () => true }));
jest.mock("@/ui/timesheet", () => ({ cssColour: (css: string) => css, Choices:({ options, onChange }: any) => {
  const { Text, Pressable, View } = require("react-native");
  return <View>{options.map((o: any) => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} onPress={() => onChange(o.value)}><Text>{o.label}</Text></Pressable>)}</View>;
} }));
jest.mock("@/ui/index", () => {
  const { View, Text, Pressable, TextInput } = require("react-native");
  const Wrapper = ({ children, testID }: any) => <View testID={testID}>{children}</View>;
  return { Screen: Wrapper, Card: Wrapper, Field: Wrapper, ErrorBanner: () => null,
    Empty: ({ title, action }: any) => <View><Text>{title}</Text>{action}</View>,
    useLayout: () => ({ width: 390, gutter: 18, column: { paddingLeft: 18, paddingRight: 18 } }), Input: (props: any) => <TextInput {...props} />,
    Button: ({ title, disabled, busy, onPress, testID }: any) => <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} disabled={disabled || busy} onPress={onPress}><Text>{title}</Text></Pressable>,
  };
});
beforeEach(() => { jest.clearAllMocks(); mockData = { owing: mockRows, today: "2026-10-19", owed_total: duration(11) }; jest.mocked(timesheet.recordPayment).mockResolvedValue(mockData); });

test("shows separate workplace cards and only the selected job's payment controls", async () => {
  const screen = await render(<Pay />);
  expect(screen.getByTestId("pay-1")).toBeTruthy();
  expect(screen.queryByTestId("pay-2")).toBeNull();
  expect(screen.getByRole("button", { name: "Previous workplace" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", { name: "Next workplace" }));
  expect(screen.queryByTestId("pay-1")).toBeNull();
  expect(screen.getByTestId("pay-2")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add a pay rate" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next workplace" })).toBeDisabled();
  expect(timesheet.recordPayment).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", { name: "Show Harbour Market" }));
  expect(screen.getByTestId("pay-1")).toBeTruthy();
});

test("swiping switches the selected workplace and never mixes its payment action", async () => {
  const screen = await render(<Pay />);
  await fireEvent(screen.getByTestId("pay-workplace-carousel"), "momentumScrollEnd", { nativeEvent: { contentOffset: { x: 340 } } });
  expect(screen.getByTestId("pay-2")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Payment received" }));
  expect(mockConfirm).toHaveBeenLastCalledWith("Mark City Cafe paid?", expect.stringContaining("Only this workplace"), "Payment received", expect.any(Function), false);
  expect(timesheet.recordPayment).not.toHaveBeenCalled();
  await act(async () => { await mockConfirm.mock.calls.at(-1)[3](); });
  expect(timesheet.recordPayment).toHaveBeenCalledWith(2, "now", undefined);
  expect(mockChanged).toHaveBeenCalled();
  expect(mockTell).toHaveBeenCalled();
});

test("custom date settlement and undo retain their scoped confirmation", async () => {
  const screen = await render(<Pay />);
  await fireEvent.press(screen.getByRole("button", { name: "Choose what this payment covers" }));
  await fireEvent.press(screen.getByRole("button", { name: "Choose a date" }));
  await fireEvent.changeText(screen.getByLabelText("Paid up to and including"), "2026-10-12");
  await fireEvent.press(screen.getByRole("button", { name: "Payment received" }));
  await act(async () => { await mockConfirm.mock.calls.at(-1)[3](); });
  expect(timesheet.recordPayment).toHaveBeenCalledWith(1, "date", "2026-10-12");
  await fireEvent.press(screen.getByRole("button", { name: "Undo last payment at Harbour Market" }));
  expect(timesheet.undoPayment).not.toHaveBeenCalled();
  await act(async () => { await mockConfirm.mock.calls.at(-1)[3](); });
  expect(timesheet.undoPayment).toHaveBeenCalledWith(1);
});

test("a rejected payment reports failure without success feedback", async () => {
  jest.mocked(timesheet.recordPayment).mockRejectedValueOnce(new Error("That period was already paid."));
  const screen = await render(<Pay />);
  await fireEvent.press(screen.getByRole("button", { name: "Payment received" }));
  await act(async () => { await mockConfirm.mock.calls.at(-1)[3](); });
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith("Not recorded", "That period was already paid."));
  expect(mockChanged).not.toHaveBeenCalled();
  expect(mockTell).not.toHaveBeenCalled();
});

test("settled jobs cannot record another payment and an empty wallet offers workplace creation", async () => {
  mockData = { ...mockData, owing: [{ ...mockRows[0], worked: duration(0), owed_pay: null, shifts: 0, due: [] }] };
  const screen = await render(<Pay />);
  expect(screen.queryByRole("button", { name: "Payment received" })).toBeNull();
  expect(screen.getAllByText("All clear").length).toBeGreaterThan(0);
  mockData = { ...mockData, owing: [] };
  await screen.rerender(<Pay />);
  await fireEvent.press(screen.getByRole("button", { name: "Add a workplace" }));
  expect(mockPush).toHaveBeenCalledWith("/workplaces/new");
});

test("a slow horizontal scroll updates the selected workplace without requiring momentum", async () => {
  const screen = await render(<Pay />);
  await fireEvent.scroll(screen.getByTestId("pay-workplace-carousel"), { nativeEvent: { contentOffset: { x: 340, y: 0 }, contentSize: { width: 700, height: 200 }, layoutMeasurement: { width: 354, height: 200 } } });
  await waitFor(() => expect(screen.getByTestId("pay-2")).toBeTruthy());
  expect(screen.queryByTestId("pay-1")).toBeNull();
  expect(timesheet.recordPayment).not.toHaveBeenCalled();
});
