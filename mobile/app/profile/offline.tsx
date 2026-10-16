import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, Page, PageTitle, Screen } from "@/ui";
import { usePendingShifts, removePending, retryPending, syncShifts } from "@/offline/shifts";
import { usePrivateScope, writePrivate } from "@/storage/private";
import { confirm, notify } from "@/ui/confirm";
import { useTheme, sp } from "@/ui/theme";

export default function OfflineShifts() {
  const currentScope = React.useRef<string | null>(null);
  const [rows] = usePendingShifts(), scope = usePrivateScope(), t = useTheme(), router = useRouter();
  currentScope.current = scope;
  return <Screen back><Page><PageTitle sub="Pending shifts stay on this device. A conflict is kept for review instead of being silently changed.">Offline shifts</PageTitle>
    {!rows.length ? <Text style={{ color: t.muted }}>Everything has synced. No shifts are waiting.</Text> : null}
    {rows.map(row => <Card key={row.id}>
      <Text style={{ color: t.text, fontWeight: "700" }}>{row.input.clock_in.replace("T", " ")} → {row.input.clock_out.replace("T", " ") || "Still running"}</Text>
      <Text style={{ color: row.review ? t.danger : t.muted }}>{row.error || "Waiting for a connection"}</Text>
      <View style={{ gap: sp[2], marginTop: sp[3] }}>
        <Button title="Retry sync" onPress={async () => { if (scope) { await retryPending(scope, row.id); await syncShifts(scope, () => currentScope.current === scope); } }} />
        <Button title="Review as a draft" kind="plain" onPress={() => confirm("Review this shift?", "Check existing shifts first if the server reported a conflict. This removes it from automatic sync.", "Review", async () => {
          if (!scope) return;
          const key = `review-${row.id}`;
          await writePrivate(scope, `shift:new:${key}`, { workplace: row.input.workplace, clockIn: row.input.clock_in, clockOut: row.input.clock_out, note: row.input.note, breaks: row.input.breaks.map((b, i) => ({ ...b, key: `b${i}` })) });
          await removePending(scope, row.id);
          router.push({ pathname: "/shifts/new", params: { draft: key } });
        })} />
        <Button title="Discard" kind="ghost" onPress={() => confirm("Discard this pending shift?", "It will no longer be retried. This does not delete a shift already saved on the server.", "Discard", () => scope ? removePending(scope, row.id).catch(() => notify("Could not discard")) : undefined)} />
      </View>
    </Card>)}
  </Page></Screen>;
}
