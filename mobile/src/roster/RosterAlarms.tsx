/**
 * Keeps the phone's alarms in step with the roster and the clock for as
 * long as somebody is signed in, whichever screen they are on — and takes
 * them all down when they sign out, so one person's shifts never ring on
 * a phone the next person is using.
 */
import { useEffect } from "react";

import { useClock, useRoster } from "@/api";
import { useSession } from "@/auth/session";

import { clearWorkAlarms, lockScreenOn, syncClock, syncShiftReminders } from "./reminders";
import { syncWorkWidgets } from "@/widgets/sync";
import { getLang, useT } from "@/i18n";

export function RosterAlarms() {
  const { me, ready } = useSession();
  const signedIn = !!me;
  useEffect(() => { if (ready && !signedIn) { void clearWorkAlarms(); void syncWorkWidgets(null); } }, [ready, signedIn]);
  return ready && me ? <Alarms key={me.username} /> : null;
}

function Alarms() {
  useT();
  const language = getLang();
  const mine = useRoster().data?.mine;
  const clock = useClock(null).data;
  useEffect(() => { if (mine) void syncShiftReminders(mine); }, [mine, language]);
  useEffect(() => { if (clock) void syncClock(clock, mine ?? []); }, [clock, mine, language]);
  useEffect(() => {
    let active = true;
    if (clock) void lockScreenOn().then((lock) => { if (active) return syncWorkWidgets(clock, mine ?? [], lock); });
    return () => { active = false; };
  }, [clock, mine, language]);
  return null;
}
