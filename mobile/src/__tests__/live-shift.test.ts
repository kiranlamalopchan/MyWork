import { syncClock } from "@/roster/reminders";
import type { ClockState } from "@/api/types";

const mockShow = jest.fn((_options: unknown) => true), mockHide = jest.fn(), mockSchedule = jest.fn(async () => "id"), mockDismiss = jest.fn(async () => {});
jest.mock("../../modules/live-shift", () => ({ LiveShift: { show: (o: unknown) => mockShow(o), hide: () => mockHide() } }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/push/register", () => ({ notifications: () => ({
  getPermissionsAsync: async () => ({ status: "granted" }),
  getAllScheduledNotificationsAsync: async () => [],
  cancelScheduledNotificationAsync: async () => {},
  scheduleNotificationAsync: () => mockSchedule(),
  dismissNotificationAsync: () => mockDismiss(),
  getPresentedNotificationsAsync: async () => [],
  SchedulableTriggerInputTypes: { DATE: "date" },
}) }));

test("Android shows the running shift live — timer from banked breaks, then the break — and takes it down", async () => {
  const clockIn = Date.parse("2026-11-10T00:00:00Z");
  const state = { shift: { id: 9, status: "WORKING", workplace: { id: 1, name: "Cafe" }, clock_in: new Date(clockIn).toISOString(), banked_break_seconds: 600, in_at: "9 am", running_break: null } } as unknown as ClockState;
  await syncClock(state, []);
  expect(mockShow).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "Clocked in at Cafe", mode: "work", since: clockIn + 600_000, shiftId: 9,
    actions: [{ id: "start-break", label: "Start break" }, { id: "clock-out", label: "Clock out" }],
  }));
  // The live one stands in for the plain lock-screen line.
  expect(mockSchedule).not.toHaveBeenCalled();

  state.shift!.status = "ON_BREAK";
  state.shift!.running_break = { start: new Date(clockIn + 3600_000).toISOString(), start_at: "10 am" } as NonNullable<ClockState["shift"]>["running_break"];
  await syncClock(state, []);
  expect(mockShow).toHaveBeenLastCalledWith(expect.objectContaining({
    title: "On break at Cafe", mode: "break", since: clockIn + 3600_000,
    actions: [{ id: "end-break", label: "End break" }, { id: "clock-out", label: "Clock out" }],
  }));

  await syncClock({ shift: null } as ClockState, []);
  expect(mockHide).toHaveBeenCalled();
});

test("without permission to post live, the plain notification is used", async () => {
  mockShow.mockReturnValueOnce(false);
  const state = { shift: { id: 3, status: "WORKING", workplace: null, clock_in: new Date().toISOString(), banked_break_seconds: 0, in_at: "9 am", running_break: null } } as unknown as ClockState;
  await syncClock(state, []);
  expect(mockSchedule).toHaveBeenCalled();
});
