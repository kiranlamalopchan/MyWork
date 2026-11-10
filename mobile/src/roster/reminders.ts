/**
 * The phone's own alarms for work: a reminder before a rostered shift, a
 * nudge if you are still clocked in after it was due to end, and the
 * running shift kept on the lock screen with the clock's buttons on it.
 *
 * These are set on the phone rather than sent by the server, on purpose.
 * The server's reminders ride on other people's page loads (see
 * apps/timeclock/middleware.py), and a shift that starts at five in the
 * morning has nobody loading pages before it. An alarm the phone holds goes
 * off whether or not anyone — including this phone — is online.
 *
 * Everything here does nothing, quietly, where the phone may not be
 * buzzed: no permission, Expo Go on Android, a build without the module.
 */
import * as SecureStore from "expo-secure-store";

import type { ClockState, Planned } from "@/api";
import { getLang, tr } from "@/i18n";
import { notifications } from "@/push/register";

/** Minutes of warning before a shift; 0 is off. */
export const LEADS = [0, 15, 30, 60, 120] as const;
export const DEFAULT_LEAD = 60;
const LEAD_KEY = "mywork.reminder.lead";
const LOCK_KEY = "mywork.reminder.lockscreen";
let leadOverride: number | undefined;
let lockOverride: boolean | undefined;

// How long after a rostered shift's end before "still clocked in?" is asked.
const OVERRUN_MINUTES = 15;
// iOS holds 64 pending alarms per app; the nearest shifts are the ones that matter.
const MAX_SCHEDULED = 20;

const START = "roster-start-";
const OVERRUN_ID = "clock-overrun";
const STATUS_ID = "clock-status";
let alarmQueue: Promise<unknown> = Promise.resolve();
function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const next = alarmQueue.then(work, work);
  alarmQueue = next.catch(() => {});
  return next;
}
/** The buttons on the lock-screen shift. Handled in push/useNotificationNavigation. */
export const CLOCK_CATEGORY = "clock";
export const BREAK_CATEGORY = "clock-break";
export const ACTION_CLOCK_OUT = "clock-out";
export const ACTION_START_BREAK = "start-break";
export const ACTION_END_BREAK = "end-break";

export const ROSTER_URL = "/timesheet/?go=roster";
const CLOCK_URL = "/timesheet/";

export async function getLead(): Promise<number> {
  if (leadOverride !== undefined) return leadOverride;
  try {
    const raw = await SecureStore.getItemAsync(LEAD_KEY);
    const value = raw === null ? DEFAULT_LEAD : Number(raw);
    return (LEADS as readonly number[]).includes(value) ? value : DEFAULT_LEAD;
  } catch {
    return DEFAULT_LEAD;
  }
}

export async function setLead(minutes: number): Promise<void> {
  leadOverride = minutes;
  try { await SecureStore.setItemAsync(LEAD_KEY, String(minutes)); } catch { /* lasts this run */ }
}

export async function lockScreenOn(): Promise<boolean> {
  if (lockOverride !== undefined) return lockOverride;
  try { return (await SecureStore.getItemAsync(LOCK_KEY)) !== "0"; } catch { return true; }
}

export async function setLockScreen(on: boolean): Promise<void> {
  lockOverride = on;
  try { await SecureStore.setItemAsync(LOCK_KEY, on ? "1" : "0"); } catch { /* lasts this run */ }
  if (!on) await clearShiftStatus();
}

export function leadWords(minutes: number): string {
  if (!minutes) return tr("Off");
  if (minutes < 60) return tr("{n} minutes before", { n: minutes });
  return minutes === 60 ? tr("1 hour before") : tr("{n} hours before", { n: minutes / 60 });
}

async function allowed() {
  const Notifications = notifications();
  if (!Notifications) return null;
  try {
    return (await Notifications.getPermissionsAsync()).status === "granted" ? Notifications : null;
  } catch {
    return null;
  }
}

/** When each of `shifts` should be announced, given `lead` minutes — the part worth testing. */
export function reminderTimes(shifts: Planned[], lead: number, now: number): { shift: Planned; at: Date }[] {
  if (!lead) return [];
  return shifts
    .filter((s) => s.mine)
    .map((shift) => ({ shift, at: new Date(Date.parse(shift.starts) - lead * 60_000) }))
    .filter(({ at }) => at.getTime() > now + 5_000)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, MAX_SCHEDULED);
}

/**
 * Make the phone's alarms match the roster: every one of ours is taken down
 * and the ones still wanted are set again. Called whenever the roster is
 * read, so a shift that was moved, removed or handed to a friend loses its
 * alarm the next time the app sees the list.
 */
export function syncShiftReminders(shifts: Planned[]): Promise<number> {
  return inOrder(() => updateShiftReminders(shifts));
}

async function updateShiftReminders(shifts: Planned[]): Promise<number> {
  const Notifications = await allowed();
  if (!Notifications) return 0;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter((n) => n.identifier.startsWith(START)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const lead = await getLead();
    const wanted = reminderTimes(shifts, lead, Date.now());
    for (const { shift, at } of wanted) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${START}${shift.id}`,
        content: {
          title: tr("Shift at {place}", { place: shift.place }),
          body: tr("Starts {when} · {time}", { when: inWords(lead), time: shift.time }),
          sound: true,
          data: { url: ROSTER_URL },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "default" },
      });
    }
    return wanted.length;
  } catch {
    return 0;
  }
}

function inWords(minutes: number): string {
  if (minutes < 60) return tr("in {n} minutes", { n: minutes });
  return minutes === 60 ? tr("in 1 hour") : tr("in {n} hours", { n: minutes / 60 });
}

/** The rostered shift the clock is running inside, if there is one. */
export function rosteredNow(shifts: Planned[], now: number): Planned | null {
  // A little early or a little late still counts as that shift.
  const slack = 2 * 3600_000;
  return shifts.find((s) => s.mine && Date.parse(s.starts) - slack <= now && now < Date.parse(s.ends)) ?? null;
}

/**
 * Follow the clock: with a shift running, keep it on the lock screen and
 * set the "still clocked in?" nudge for after its rostered end; with none,
 * take both away.
 */
export function syncClock(state: ClockState | null | undefined, shifts: Planned[] = []): Promise<void> {
  return inOrder(() => updateClock(state, shifts));
}

async function updateClock(state: ClockState | null | undefined, shifts: Planned[]): Promise<void> {
  const Notifications = await allowed();
  if (!Notifications) return;
  try {
    const shift = state?.shift;
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter((n) => n.identifier.startsWith(OVERRUN_ID) && n.identifier !== `${OVERRUN_ID}-${shift?.id}`)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!shift) {
      await clearShiftStatus();
      return;
    }
    const where = shift.workplace?.name || tr("work");

    const planned = rosteredNow(shifts.filter((s) => !shift.workplace || s.workplace?.id === shift.workplace.id || s.place === shift.workplace.name), Date.parse(shift.clock_in));
    if (planned) {
      const at = new Date(Date.parse(planned.ends) + OVERRUN_MINUTES * 60_000);
      if (at.getTime() > Date.now() + 5_000) {
        await Notifications.scheduleNotificationAsync({
          identifier: `${OVERRUN_ID}-${shift.id}`,
          content: {
            title: tr("Still clocked in?"),
            body: tr("Your shift at {place} was due to end at {time}. Clock out if you have finished.", { place: where, time: planned.time.split("–").pop()!.trim() }),
            sound: true,
            categoryIdentifier: CLOCK_CATEGORY,
            data: { url: CLOCK_URL, shiftId: shift.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: "default" },
        });
      }
    }

    if (!(await lockScreenOn())) return;
    const onBreak = shift.status === "ON_BREAK";
    // Put up once per state. The clock is asked about every few seconds
    // while the app is open, and the same line posted again each time would
    // light the screen each time.
    const key = `${shift.id}:${shift.status}:${shift.running_break?.start ?? ""}:${getLang()}`;
    const up = await Notifications.getPresentedNotificationsAsync();
    if (up.some((n) => n.request.identifier === STATUS_ID && n.request.content.data?.key === key)) return;
    await Notifications.scheduleNotificationAsync({
      identifier: STATUS_ID,
      content: {
        title: onBreak ? tr("On break at {place}", { place: where }) : tr("Clocked in at {place}", { place: where }),
        body: onBreak && shift.running_break
          ? tr("Break since {time}.", { time: shift.running_break.start_at })
          : tr("Since {time}. Hold for the clock's buttons.", { time: shift.in_at }),
        // Quiet: this is a standing fact on the lock screen, not news.
        sound: false,
        sticky: true,
        autoDismiss: false,
        categoryIdentifier: onBreak ? BREAK_CATEGORY : CLOCK_CATEGORY,
        data: { url: CLOCK_URL, status: true, key, shiftId: shift.id },
      },
      trigger: null,
    });
  } catch {
    /* a lock-screen line is not worth an error */
  }
}

export async function clearShiftStatus(): Promise<void> {
  const Notifications = notifications();
  if (!Notifications) return;
  try { await Notifications.dismissNotificationAsync(STATUS_ID); } catch { /* it was not up */ }
}

/** Signing out: nothing of the last person's is left to ring. */
export function clearWorkAlarms(): Promise<void> {
  return inOrder(removeWorkAlarms);
}

async function removeWorkAlarms(): Promise<void> {
  const Notifications = notifications();
  if (!Notifications) return;
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(pending.filter((n) => n.identifier.startsWith(START) || n.identifier.startsWith(OVERRUN_ID)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch {
    /* nothing was set */
  }
  await clearShiftStatus();
}

/** Tell the phone which buttons a clock notification wears. Once, at start-up. */
export async function registerClockActions(): Promise<void> {
  const Notifications = notifications();
  if (!Notifications) return;
  try {
    await Notifications.setNotificationCategoryAsync(CLOCK_CATEGORY, [
      { identifier: ACTION_START_BREAK, buttonTitle: tr("Start break"), options: { opensAppToForeground: true } },
      { identifier: ACTION_CLOCK_OUT, buttonTitle: tr("Clock out"), options: { opensAppToForeground: true, isDestructive: true } },
    ]);
    await Notifications.setNotificationCategoryAsync(BREAK_CATEGORY, [
      { identifier: ACTION_END_BREAK, buttonTitle: tr("End break"), options: { opensAppToForeground: true } },
      { identifier: ACTION_CLOCK_OUT, buttonTitle: tr("Clock out"), options: { opensAppToForeground: true, isDestructive: true } },
    ]);
  } catch {
    /* buttons are a nicety */
  }
}
