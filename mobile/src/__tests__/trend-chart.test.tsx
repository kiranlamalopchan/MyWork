import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { delta, smooth, TrendChart } from "@/ui/TrendChart";

const figure = (hours: number, gross: number | null) => ({ hours, gross, worked: { seconds: hours * 3600, hm: `${hours}h`, hms: "", minutes: hours * 60, decimal: String(hours) } });
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let mockTrend: any;
let mockRange: string[] = [];

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn() }));
jest.mock("@/api", () => ({ useTrend: (range: string) => { mockRange.push(range); return { data: mockTrend, isLoading: false }; } }));
jest.mock("@/ui/index", () => {
  const { View } = require("react-native");
  return { Card: ({ children, testID }: any) => <View testID={testID}>{children}</View> };
});
function week(priced = true) {
  return {
    range: "week", title: "This week", compare_title: "Last week", priced,
    ranges: [{ value: "week", label: "Weekly" }, { value: "fortnight", label: "Fortnightly" }, { value: "month", label: "Monthly" }, { value: "months", label: "6 months" }],
    points: days.map((label, i) => ({ ...figure(i < 3 ? 8 : 0, priced ? (i < 3 ? 200 : 0) : null), start: `2026-10-${12 + i}`, label, long_label: `${label} ${12 + i} Oct`, upcoming: i > 3, current: i === 3 })),
    previous: days.map(() => figure(4, priced ? 100 : null)),
    total: figure(24, priced ? 600 : null),
    previous_total: figure(28, priced ? 700 : null),
  };
}

beforeEach(() => { mockTrend = week(); mockRange = []; });

test("leads with the span's total and how it compares, and reads today first", async () => {
  const view = await render(<TrendChart />);
  expect(view.getByTestId("trend-total")).toHaveTextContent("$600.00");
  // Sunday to Wednesday ($600) against last Sunday to Wednesday ($400), not all of last week.
  expect(view.getByText("50%")).toBeTruthy();
  expect(view.getByTestId("trend-caption")).toHaveTextContent("Wed 15 Oct · 0h · last week $100.00");
});

test("a day tapped is the day read; a day still to come says so", async () => {
  const view = await render(<TrendChart />);
  await fireEvent.press(view.getByLabelText("Mon 13 Oct"));
  expect(view.getByTestId("trend-caption")).toHaveTextContent("Mon 13 Oct · 8h · last week $100.00");
  await fireEvent.press(view.getByLabelText("Sat 18 Oct"));
  expect(view.getByTestId("trend-caption")).toHaveTextContent("Sat 18 Oct · last week $100.00");
});

test("weekly, fortnightly, monthly or six months, chosen on the switch", async () => {
  const view = await render(<TrendChart />);
  expect(view.getByLabelText("Weekly")).toBeSelected();
  for (const [label, range] of [["Fortnightly", "fortnight"], ["Monthly", "month"], ["6 months", "months"]]) {
    await fireEvent.press(view.getByLabelText(label));
    expect(mockRange[mockRange.length - 1]).toBe(range);
  }
});

test("a job without a rate is counted in hours", async () => {
  mockTrend = week(false);
  const view = await render(<TrendChart />);
  expect(view.getByText("Worked")).toBeTruthy();
  expect(view.getByTestId("trend-total")).toHaveTextContent("24h");
});

test("the comparison says nothing when there is nothing to compare", () => {
  expect(delta(0, 0)).toBeNull();
  expect(delta(10, 0)).toEqual({ up: true, text: "New" });
  expect(delta(50, 100)).toEqual({ up: false, text: "50%" });
  expect(delta(100, 100)).toBeNull();
});

test("the line passes through every point and never dips past a flat stretch", () => {
  const d = smooth([{ x: 0, y: 10 }, { x: 10, y: 50 }, { x: 20, y: 50 }, { x: 30, y: 0 }]);
  expect(d.startsWith("M 0 10")).toBe(true);
  expect(d).toContain(", 10 50 C");
  // Across the flat stretch the handles stay level with it.
  expect(d).toContain("C 13.333333333333334 50, 16.666666666666668 50, 20 50");
});
