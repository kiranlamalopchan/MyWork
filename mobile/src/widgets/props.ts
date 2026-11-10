import type { ClockState, Planned } from "@/api/types";
import { tr } from "@/i18n";

/** No nulls: iOS keeps these in UserDefaults, which throws on a null inside a dictionary. */
export type WorkWidgetProps = { title: string; subtitle: string; openLabel: string; timerStart?: string };

/** Only display data crosses into the extension; never credentials or account details. */
export function widgetProps(clock: ClockState | null, upcoming?: Planned): WorkWidgetProps {
  const shift = clock?.shift;
  if (!shift) return {
    title: tr("Not started"),
    subtitle: upcoming ? `${upcoming.day} · ${upcoming.time} · ${upcoming.place}` : tr("ready when you are"),
    openLabel: tr("Open clock"),
  };
  const onBreak = shift.status === "ON_BREAK";
  const timerStart = onBreak ? shift.running_break?.start : new Date(Date.parse(shift.clock_in) + shift.banked_break_seconds * 1000).toISOString();
  return {
    title: onBreak ? tr("On break") : tr("Clocked in at {place}", { place: shift.workplace?.name || tr("work") }),
    subtitle: onBreak ? tr("since {time}", { time: shift.running_break?.start_at || shift.in_at }) : tr("in since {time}", { time: shift.in_at }),
    openLabel: tr("Open clock"),
    ...(timerStart ? { timerStart } : {}),
  };
}
