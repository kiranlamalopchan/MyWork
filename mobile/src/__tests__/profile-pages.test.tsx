import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import Statement from "../../app/profile/statement";
import Activity from "../../app/profile/activity";
import { timesheet, type Activity as ActivityData } from "@/api";
import { openPdf } from "@/ui/pdf";

const mockData: ActivityData = {
  week_hours: 18.5, shift_count: 12, workplace_count: 2, friend_count: 3, notice_count: 4, comment_count: 5, reactions_received: 6,
  statement: { this_month: ["2026-11-01", "2026-11-10"], last_month: ["2026-10-01", "2026-10-31"], today: "2026-11-10", workplaces: [{ id: 1, name: "Cafe" }, { id: 2, name: "Shop" }] },
};
let mockQuery: { data?: ActivityData; error?: Error; isLoading: boolean; refetch: jest.Mock };
jest.mock("@/api", () => ({ useActivity: () => mockQuery, timesheet: { statementUrl: jest.fn(() => "https://example.test/statement.pdf") } }));
jest.mock("@/ui/pdf", () => ({ openPdf: jest.fn(async () => {}) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/ui", () => {
  const real = jest.requireActual("@/ui"), { View, Text } = jest.requireActual("react-native");
  return { ...real, Screen: ({ children, backLabel }: any) => <View accessibilityLabel={backLabel}>{children}</View>,
    Page: ({ children }: any) => <View>{children}</View>, PageTitle: ({ children }: any) => <Text>{children}</Text>, usePullRefresh: () => undefined };
});
jest.mock("@/ui/Skeleton", () => ({ SkeletonForm: () => null, SkeletonRows: () => null }));

beforeEach(() => { jest.clearAllMocks(); mockQuery = { data: mockData, isLoading: false, refetch: jest.fn() }; });

test("Statement opens with visible fields, month presets and a working PDF download", async () => {
  const page = await render(<Statement />);
  expect(page.getByLabelText("Profile")).toBeTruthy();
  expect(page.getByTestId("statement-from").props.value).toBe("2026-11-01");
  await fireEvent.press(page.getByText("Last month"));
  expect(page.getByTestId("statement-from").props.value).toBe("2026-10-01");
  expect(page.getByTestId("statement-to").props.value).toBe("2026-10-31");
  await fireEvent.press(page.getByTestId("statement-download"));
  await waitFor(() => expect(timesheet.statementUrl).toHaveBeenCalledWith("2026-10-01", "2026-10-31", ""));
  expect(openPdf).toHaveBeenCalledWith("https://example.test/statement.pdf", "statement-2026-10-01-to-2026-10-31.pdf");
});

test("invalid dates stay on the page with field errors instead of attempting a download", async () => {
  const page = await render(<Statement />);
  await fireEvent.changeText(page.getByTestId("statement-from"), "2026-02-30");
  await fireEvent.press(page.getByTestId("statement-download"));
  expect(page.getByText("Enter a valid start date as YYYY-MM-DD.")).toBeTruthy();
  expect(openPdf).not.toHaveBeenCalled();
  await fireEvent.changeText(page.getByTestId("statement-from"), "2026-11-20");
  await fireEvent.press(page.getByTestId("statement-download"));
  expect(page.getByText("Choose an end date on or after the start date.")).toBeTruthy();
});

test("a failed download preserves dates and provides a safe retry", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.mocked(openPdf).mockRejectedValueOnce(new TypeError("PrivateFile.swift:88"));
  const page = await render(<Statement />);
  await fireEvent.press(page.getByTestId("statement-download"));
  await waitFor(() => expect(page.getByText("Something went wrong. Please try again.")).toBeTruthy());
  expect(page.queryByText("PrivateFile.swift:88")).toBeNull();
  expect(page.getByTestId("statement-from").props.value).toBe("2026-11-01");
  await fireEvent.press(page.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(openPdf).toHaveBeenCalledTimes(2));
  warn.mockRestore();
});

test("Activity displays its overview immediately and retains a way back to Profile", async () => {
  const page = await render(<Activity />);
  expect(page.getByLabelText("Profile")).toBeTruthy();
  expect(page.getByText("Worked this week")).toBeTruthy();
  for (const label of ["Shifts", "Workplaces", "Friends", "Notices", "Comments", "Reactions received"]) expect(page.getByText(label)).toBeTruthy();
});
