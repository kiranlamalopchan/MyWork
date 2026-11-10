/**
 * The roster: the shifts you are due to work, and the ones your friends
 * need covered. A shift of yours can be put up for a friend to take — the
 * first to take it has it — and one of theirs taken with a tap. The phone
 * sets its own alarm before each of yours (src/roster/reminders.ts).
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, roster, useRoster, useRosterChanged, type Planned, type RosterPage } from "@/api";
import { unreachable } from "@/api/client";
import { useT } from "@/i18n";
import { errorMessage } from "@/api/errors";
import { Avatar, Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen, SectionLabel, usePullRefresh } from "@/ui";
import { SkeletonRows } from "@/ui/Skeleton";
import { choose, confirm, notify } from "@/ui/confirm";
import { success } from "@/ui/haptics";
import { alpha, radius, sp, useTheme } from "@/ui/theme";

export default function Roster() {
  const tr = useT();
  const router = useRouter();
  const q = useRoster();
  const refresh = usePullRefresh(q.refetch);
  const changed = useRosterChanged();
  const [busy, setBusy] = useState<number | null>(null);

  const run = async (id: number, work: () => Promise<RosterPage>, done?: string) => {
    if (busy !== null) return;
    setBusy(id);
    try {
      changed(await work());
      success();
      if (done) notify(done);
    } catch (error) {
      // A shift somebody else took first: the server sends the list as it now stands.
      if (error instanceof ApiError && error.status === 409) changed();
      notify(tr("That didn't work"), unreachable(error) ? tr("Check your connection and try again.") : errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const manage = (shift: Planned) => choose(shift.place, [
    { label: tr("Edit"), onPress: () => router.push(`/roster/${shift.id}` as never) },
    shift.offered
      ? { label: tr("Take it back"), onPress: () => { void run(shift.id, () => roster.withdraw(shift.id)); } }
      : { label: tr("Ask a friend to cover"), onPress: () => { void run(shift.id, () => roster.offer(shift.id)); } },
    { label: tr("Remove"), destructive: true, onPress: () => confirm(tr("Remove this shift?"), tr("It comes off your roster, and its reminder with it."), tr("Remove"), () => { void run(shift.id, () => roster.remove(shift.id)); }) },
  ]);

  const take = (shift: Planned) => confirm(
    tr("Take this shift?"),
    tr("{day}, {time} at {place} goes on your roster, and {name} is told.", { day: shift.day, time: shift.time, place: shift.place, name: shift.owner?.name || "" }),
    tr("Take shift"),
    () => { void run(shift.id, () => roster.take(shift.id)); },
    false,
  );

  const data = q.data;
  return (
    <Screen back backLabel={tr("Work")}>
      <Page refreshControl={refresh}>
        <PageTitle sub={tr("Shifts still to come, and the ones your friends need covered.")}>{tr("Roster")}</PageTitle>
        {q.error ? <ErrorBanner error={q.error} onRetry={q.refetch} /> : null}
        {q.isLoading ? <SkeletonRows count={3} /> : null}

        {data && data.workplaces.length === 0 ? (
          <Empty icon="home-outline" title={tr("Add a workplace first")} sub={tr("A shift needs somewhere to be.")}
            action={<Button title={tr("Add workplace")} icon="add" onPress={() => router.push("/workplaces/new")} />} />
        ) : null}

        {data ? (
          <>
            {data.workplaces.length > 0 ? <Button title={tr("Add a shift")} icon="add" onPress={() => router.push("/roster/new" as never)} testID="roster-add" /> : null}
            <SectionLabel>{tr("Your shifts")}</SectionLabel>
            {data.mine.length === 0 ? (
              <Empty icon="calendar-outline" title={tr("Nothing rostered")} sub={tr("Add the shifts you know about and the phone reminds you before each one.")} />
            ) : (
              <Card pad={false}>
                {data.mine.map((shift, i) => (
                  <Row key={shift.id} shift={shift} last={i === data.mine.length - 1}
                    right={<Button title={tr("Manage")} size="sm" kind="plain" busy={busy === shift.id} onPress={() => manage(shift)} testID={`roster-manage-${shift.id}`} />} />
                ))}
              </Card>
            )}
          </>
        ) : null}

        {data && data.offers.length > 0 ? (
          <>
            <SectionLabel>{tr("Friends need cover")}</SectionLabel>
            <Card pad={false}>
              {data.offers.map((shift, i) => (
                <Row key={shift.id} shift={shift} last={i === data.offers.length - 1}
                  right={<Button title={tr("Take")} size="sm" busy={busy === shift.id} onPress={() => take(shift)} testID={`roster-take-${shift.id}`} />} />
              ))}
            </Card>
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

function Row({ shift, right, last }: { shift: Planned; right: React.ReactNode; last: boolean }) {
  const t = useTheme(), tr = useT();
  return (
    <View style={[styles.row, { borderBottomColor: t.line, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth }]}>
      {shift.owner ? <Avatar person={shift.owner} size={40} live={false} /> : (
        <View style={[styles.date, { backgroundColor: alpha(t.brand, 0.12) }]}>
          <Ionicons name="calendar-outline" size={20} color={t.brand} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>{shift.day} · {shift.place}</Text>
        <Text style={{ color: t.text2, fontSize: 14 }}>{shift.time} · {shift.length}</Text>
        {shift.owner ? <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{tr("{name} needs cover", { name: shift.owner.name })}</Text> : null}
        {shift.given_by ? <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{tr("Taken from {name}", { name: shift.given_by.name })}</Text> : null}
        {shift.note ? <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={2}>{shift.note}</Text> : null}
        {shift.mine && shift.offered ? (
          <View style={[styles.tag, { backgroundColor: t.warnSoft }]}>
            <Ionicons name="hand-left-outline" size={12} color={t.warn} />
            <Text style={{ color: t.warn, fontSize: 12, fontWeight: "700" }}>{tr("Waiting for a friend to take it")}</Text>
          </View>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3], minHeight: 64 },
  date: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, marginTop: 3 },
});
