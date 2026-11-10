import * as SecureStore from "expo-secure-store";
import { ApiError } from "@/api/client";
import { describeError, errorMessage, redact } from "@/api/errors";
import { getLang, setLang, tr } from "@/i18n";
import { clearWorkAlarms, reminderTimes, setLead, syncClock, syncShiftReminders } from "@/roster/reminders";
import { widgetProps } from "@/widgets/props";
import type { ClockState, Planned } from "@/api/types";

const mockPending: { identifier: string }[] = [];
const mockSchedule = jest.fn(async (request) => { mockPending.push({ identifier: request.identifier }); return request.identifier; });
const mockCancel = jest.fn(async (id: string) => { const i = mockPending.findIndex((n) => n.identifier === id); if (i >= 0) mockPending.splice(i, 1); });
const mockDismiss = jest.fn(async (_identifier: string) => {});
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/push/register", () => ({ notifications: () => ({
  getPermissionsAsync: async () => ({ status: "granted" }),
  getAllScheduledNotificationsAsync: async () => [...mockPending],
  cancelScheduledNotificationAsync: (...args: [string]) => mockCancel(...args),
  scheduleNotificationAsync: (...args: [unknown]) => mockSchedule(...args),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getPresentedNotificationsAsync: async () => [],
  SchedulableTriggerInputTypes: { DATE: "date" },
}) }));

const now = Date.parse("2026-11-10T00:00:00Z");
const planned = (id: number, start: number, mine = true): Planned => ({
  id, mine, starts: new Date(start).toISOString(), ends: new Date(start + 8 * 3600_000).toISOString(),
  place: "Cafe", workplace: { id: 1, name: "Cafe" }, time: "9 am – 5 pm", day: "Tue 10 Nov", date: "2026-11-10", length: "8h", note: "", offered: false, owner: null, given_by: null,
} as Planned);

beforeEach(() => { jest.clearAllMocks(); mockPending.length = 0; setLang("en"); });
afterEach(() => { jest.restoreAllMocks(); });

test("Nepali switches immediately and preserves interpolation and English fallbacks", () => {
  setLang("ne");
  expect(getLang()).toBe("ne");
  expect(tr("Clock in")).toBe("क्लक इन");
  expect(tr("{n} minutes before", { n: 15 })).toBe("15 मिनेट अघि");
  expect(tr("Untranslated {count}", { count: 3 })).toBe("Untranslated 3");
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("mywork.lang", "ne");
});

test("reminders select only future owned shifts, sorted and capped below the phone's limit", () => {
  const shifts = Array.from({ length: 30 }, (_, id) => planned(id, now + (id + 2) * 3600_000)).reverse();
  shifts.push(planned(90, now + 2 * 3600_000, false), planned(91, now));
  const result = reminderTimes(shifts, 60, now);
  expect(result).toHaveLength(20);
  expect(result[0].shift.id).toBe(0);
  expect(result[0].at.getTime()).toBe(now + 3600_000);
  expect(reminderTimes(shifts, 0, now)).toEqual([]);
});

test("a newer roster update replaces older alarms, and sign-out wins an overlapping update", async () => {
  await setLead(60);
  const start = Date.now() + 3 * 3600_000;
  await Promise.all([syncShiftReminders([planned(1, start)]), syncShiftReminders([planned(2, start)])]);
  expect(mockPending.map((n) => n.identifier)).toEqual(["roster-start-2"]);
  await Promise.all([syncShiftReminders([planned(3, start)]), clearWorkAlarms()]);
  expect(mockPending).toEqual([]);
  expect(mockDismiss).toHaveBeenCalledWith("clock-status");
});

test("a clock refresh preserves its scheduled overrun when an ended shift leaves the roster", async () => {
  const start = Date.now() - 3600_000;
  const shift = planned(1, start);
  const state = { shift: { id: 9, status: "WORKING", workplace: { id: 1, name: "Cafe" }, clock_in: new Date(start).toISOString(), banked_break_seconds: 0, in_at: "9 am" } } as ClockState;
  await syncClock(state, [shift]);
  expect(mockPending.some((n) => n.identifier === "clock-overrun-9")).toBe(true);
  await syncClock(state, []);
  expect(mockCancel).not.toHaveBeenCalledWith("clock-overrun-9");
  await syncClock({ shift: null } as ClockState, []);
  expect(mockCancel).toHaveBeenCalledWith("clock-overrun-9");
});

test("widget timer subtracts banked breaks and switches to the current break's start", () => {
  const state = { shift: { status: "WORKING", workplace: { name: "Cafe" }, clock_in: new Date(now).toISOString(), banked_break_seconds: 1800, in_at: "9 am" } } as ClockState;
  expect(widgetProps(state).timerStart).toBe(new Date(now + 1800_000).toISOString());
  state.shift!.status = "ON_BREAK";
  state.shift!.running_break = { start: new Date(now + 3600_000).toISOString(), start_at: "10 am" } as NonNullable<ClockState["shift"]>["running_break"];
  expect(widgetProps(state).timerStart).toBe(new Date(now + 3600_000).toISOString());
  expect(widgetProps(null)).not.toHaveProperty("timerStart");
  expect(JSON.stringify(widgetProps(null))).not.toContain("Cafe");
});

test("errors show translated guidance and never leak machine details", () => {
  expect(describeError(new TypeError("Cannot read password of undefined")).message).toBe("Something went wrong. Please try again.");
  expect(describeError(new ApiError(500, "database exploded")).message).toBe("Something went wrong on our side. Please try again.");
  expect(describeError(new ApiError(400, "Choose where the shift is.")).message).toBe("Choose where the shift is.");
  setLang("ne");
  expect(describeError(new ApiError(401, "Invalid token.")).message).toBe("अगाडि बढ्न फेरि साइन इन गर्नुहोस्।");
});

test("developer reports redact nested credentials and log an error only once", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const error = new Error("Bearer secret-token");
  errorMessage(error); errorMessage(error);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).not.toContain("secret-token");
  const output = JSON.stringify(redact({ password: "secret", nested: { authorization: "Token abc" }, note: "https://example.test/?key=private" }));
  expect(output).not.toContain("secret"); expect(output).not.toContain("private"); expect(output).not.toContain("abc");
});
