/**
 * Adding up weeks, away from anything that draws them — types only, so this
 * can be read by a test without a font or an icon set behind it.
 */
import type { Duration, TimesheetWeek } from "@/api";

/**
 * A total the server would have written, from seconds — the same truncation
 * and the same wording as `timeclock_extras` (`5h 19m`, `5h`, `19m`). Only
 * needed where two halves of a week are added up here rather than there.
 */
export function totalOf(seconds: number): Duration {
  const s = Math.max(Math.trunc(seconds), 0);
  const h = Math.trunc(s / 3600);
  const m = Math.trunc((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    seconds: s,
    hm: h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`,
    hms: `${pad(h)}:${pad(m)}:${pad(s % 60)}`,
    minutes: h ? `${h}h ${m}m` : `${m}m`,
    decimal: (s / 3600).toFixed(2),
  };
}

/**
 * The server groups each page of shifts on its own, so a week lying across a
 * page boundary arrives twice — once at the foot of one page, once at the head
 * of the next. Same week, so put its days back together, and add the halves up
 * rather than keep the first half's figure.
 */
export function joinWeeks(weeks: TimesheetWeek[]): TimesheetWeek[] {
  const out: TimesheetWeek[] = [];
  for (const week of weeks) {
    const open = out.find((w) => w.start === week.start);
    if (!open) { out.push({ ...week, days: [...week.days] }); continue; }
    open.days.push(...week.days);
    open.shifts += week.shifts;
    open.total = totalOf(open.total.seconds + week.total.seconds);
    // Pages come newest first, so the half arriving second holds the older end.
    open.first_label = week.first_label;
  }
  return out;
}

/** The range a fold covers: the two ends of what is actually inside it. */
export function weekLabel(week: TimesheetWeek): string {
  return week.first_label === week.last_label
    ? week.first_label
    : `${week.first_label} – ${week.last_label}`;
}
