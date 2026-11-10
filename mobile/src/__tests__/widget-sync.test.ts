import { syncWorkWidgets } from "@/widgets/sync";
import type { ClockState } from "@/api/types";

const mockSnapshot = jest.fn(), mockStart = jest.fn(), mockUpdate = jest.fn(async () => {}), mockEnd = jest.fn(async () => {});
let mockInstances: unknown[] = [];
jest.mock("@/push/register", () => ({ inExpoGo: false }));
jest.mock("@/widgets/WorkWidget", () => ({ __esModule: true, default: { updateSnapshot: (...args: unknown[]) => mockSnapshot(...args) } }));
jest.mock("@/widgets/ShiftActivity", () => ({ __esModule: true, default: { getInstances: () => mockInstances, start: (...args: unknown[]) => { mockStart(...args); mockInstances = [{ update: mockUpdate, end: mockEnd }]; } } }));

test("the live timer is reused, hidden on opt-out and removed after a queued sign-out", async () => {
  const clock = { shift: { id: 1, status: "WORKING", clock_in: "2026-11-10T00:00:00Z", in_at: "9:30 am", banked_break_seconds: 0, workplace: { name: "Cafe" } } } as ClockState;
  await syncWorkWidgets(clock);
  await syncWorkWidgets(clock);
  expect(mockStart).toHaveBeenCalledTimes(1);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  clock.shift!.status = "ON_BREAK";
  await syncWorkWidgets(clock);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  await syncWorkWidgets(clock, [], false);
  expect(mockEnd).toHaveBeenCalledWith("immediate");
  await Promise.all([syncWorkWidgets(clock), syncWorkWidgets(null)]);
  expect(mockSnapshot.mock.calls.at(-1)?.[0]).toMatchObject({ title: "Not started" });
  expect(mockSnapshot.mock.calls.at(-1)?.[0]).not.toHaveProperty("timerStart");
});
