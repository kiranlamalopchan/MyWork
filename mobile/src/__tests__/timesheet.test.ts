import { joinWeeks, totalOf, weekLabel } from "@/ui/weeks";
import type { TimesheetDay, TimesheetWeek } from "@/api";

const day = (date: string, seconds: number): TimesheetDay =>
  ({ date, label: date, total: totalOf(seconds), is_run: false, shifts: [] }) as TimesheetDay;

const week = (start: string, seconds: number, shifts: number, days: TimesheetDay[]): TimesheetWeek =>
  ({ start, first_label: days[days.length - 1].date, last_label: days[0].date, total: totalOf(seconds), shifts, days });

describe("totalOf", () => {
  it("writes a total the way the server does", () => {
    expect(totalOf(0).hm).toBe("0m");
    expect(totalOf(19 * 60).hm).toBe("19m");
    expect(totalOf(5 * 3600).hm).toBe("5h");
    expect(totalOf(5 * 3600 + 19 * 60).hm).toBe("5h 19m");
    // Seconds are dropped, never rounded up, as `_parts` drops them.
    expect(totalOf(5 * 3600 + 19 * 60 + 59).hm).toBe("5h 19m");
  });

  it("carries the other forms of the same figure", () => {
    const t = totalOf(5 * 3600 + 19 * 60 + 7);
    expect(t.hms).toBe("05:19:07");
    expect(t.decimal).toBe("5.32");
    expect(t.seconds).toBe(19147);
  });

  it("never goes below nothing", () => {
    expect(totalOf(-90).seconds).toBe(0);
    expect(totalOf(-90).hm).toBe("0m");
  });
});

describe("joinWeeks", () => {
  it("leaves separate weeks alone, in the order they came", () => {
    const out = joinWeeks([
      week("2026-09-07", 3600, 1, [day("2026-09-08", 3600)]),
      week("2026-08-31", 7200, 2, [day("2026-09-01", 7200)]),
    ]);
    expect(out.map((w) => w.start)).toEqual(["2026-09-07", "2026-08-31"]);
  });

  it("puts a week split across two pages back together", () => {
    // The same week arriving at the foot of one page and the head of the next.
    const out = joinWeeks([
      week("2026-09-07", 3 * 3600, 1, [day("2026-09-09", 3 * 3600)]),
      week("2026-09-07", 2 * 3600 + 30 * 60, 2, [day("2026-09-08", 2 * 3600 + 30 * 60)]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].days.map((d) => d.date)).toEqual(["2026-09-09", "2026-09-08"]);
    expect(out[0].shifts).toBe(3);
    // Added up, not taken from whichever half came first.
    expect(out[0].total.seconds).toBe(5 * 3600 + 30 * 60);
    expect(out[0].total.hm).toBe("5h 30m");
  });

  it("does not write through to the pages it was given", () => {
    const first = week("2026-09-07", 3600, 1, [day("2026-09-09", 3600)]);
    joinWeeks([first, week("2026-09-07", 3600, 1, [day("2026-09-08", 3600)])]);
    expect(first.days).toHaveLength(1);
    expect(first.shifts).toBe(1);
  });

  it("coasts when a page carries no weeks at all", () => {
    expect(joinWeeks([])).toEqual([]);
  });
});

describe("weekLabel", () => {
  it("names the two ends of what is in the fold", () => {
    const w = week("2026-09-07", 3600, 1, [day("9 Sep", 3600), day("6 Sep", 0)]);
    expect(weekLabel(w)).toBe("6 Sep – 9 Sep");
  });

  it("does not write a range when the fold holds one day", () => {
    const w = week("2026-09-07", 3600, 1, [day("6 Sep", 3600)]);
    expect(weekLabel(w)).toBe("6 Sep");
  });

  it("re-reads the range after two halves are joined", () => {
    // Newest page first: 9 Sep arrives, then the older 6 Sep half.
    const out = joinWeeks([
      week("2026-09-07", 3600, 1, [day("9 Sep", 3600)]),
      week("2026-09-07", 3600, 1, [day("6 Sep", 3600)]),
    ]);
    expect(weekLabel(out[0])).toBe("6 Sep – 9 Sep");
  });
});
