/**
 * A payslip held up against your own timesheet: choose the slip, and the
 * hours it paid are set beside the hours you logged for the same dates.
 * Nothing is saved — it is a second opinion on one pay.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ApiError, timesheet, useWorkplaces, type PayslipCheck } from "@/api";
import { unreachable, type FilePart } from "@/api/client";
import { useT } from "@/i18n";
import { errorMessage } from "@/api/errors";
import { Button, Card, ErrorBanner, Field, Page, PageTitle, Screen, SectionLabel } from "@/ui";
import { fail, success, warn } from "@/ui/haptics";
import { native } from "@/ui/native";
import { alpha, radius, sp, useTheme } from "@/ui/theme";
import { Choices, Ledger, LedgerRow } from "@/ui/timesheet";

const TYPES = Platform.OS === "android"
  ? ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
  : ["application/pdf", "image/*"];

const money = (value: number | null) => (value === null ? "—" : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hours = (value: number | null) => (value === null ? "—" : `${Number(value.toFixed(2))} h`);

export default function PayslipCheckScreen() {
  const t = useTheme(), tr = useT();
  const router = useRouter();
  const places = useWorkplaces();
  const [workplace, setWorkplace] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PayslipCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // The slip already chosen, so naming the job does not mean choosing it again.
  const [kept, setKept] = useState<FilePart | null>(null);

  const send = async (file: FilePart, job: number | "") => {
    setBusy(true); setError(null); setFailure(null);
    try {
      const checked = await timesheet.checkPayslip(file, job);
      setResult(checked);
      setKept(null);
      if (checked.verdict === "short") warn(); else success();
    } catch (e) {
      fail();
      setResult(null);
      if (unreachable(e)) { setFailure(e); setKept(file); }
      else {
        setError(errorMessage(e));
        // The server could not tell which job it was: keep the slip and ask.
        setKept(e instanceof ApiError && e.status === 400 && /which job/i.test(e.message) ? file : null);
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const DocumentPicker = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
      const picked = await DocumentPicker.getDocumentAsync({ type: TYPES, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      await send({ uri: asset.uri, name: asset.name, type: asset.mimeType || "application/octet-stream" }, workplace);
    } catch (e) {
      fail();
      setError(errorMessage(e));
    }
  };

  const jobs = places.data?.workplaces ?? [];
  const tone = result ? (result.verdict === "match" ? t.brand : result.verdict === "short" ? t.danger : t.warn) : t.brand;
  const icon = result?.verdict === "match" ? "checkmark-circle" : result?.verdict === "short" ? "alert-circle" : "information-circle";

  return (
    <Screen back backLabel={tr("Work")}>
      <Page>
        <PageTitle sub={tr("See whether you were paid for every hour you logged.")}>{tr("Check a payslip")}</PageTitle>
        {failure ? <ErrorBanner error={failure} onRetry={kept ? () => { void send(kept, workplace); } : undefined} /> : null}

        <Card style={{ gap: sp[4] }}>
          {jobs.length > 1 ? (
            <Field label={tr("Which job is it from?")} help={tr("Leave it and the employer's name on the payslip is used.")}>
              <Choices value={workplace} onChange={(id) => { setWorkplace(id); if (kept) void send(kept, id); }} options={jobs.map((w) => ({ value: w.id, label: w.name, css: w.css }))} />
            </Field>
          ) : null}
          <Button title={result ? tr("Check another payslip") : tr("Choose a payslip")} icon="document-text-outline" onPress={pick} busy={busy} testID="payslip-check-pick" />
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{tr("A PDF, or a photo or screenshot of one. It is read and not kept.")}</Text>
          {error ? <Text accessibilityRole="alert" style={{ color: t.danger, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
        </Card>

        {result ? (
          <>
            <Card style={{ gap: sp[3], borderColor: alpha(tone, 0.45) }} testID="payslip-check-result">
              <View style={{ flexDirection: "row", gap: sp[3], alignItems: "flex-start" }}>
                <Ionicons name={icon} size={26} color={tone} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", lineHeight: 24 }}>{result.headline}</Text>
                  <Text style={{ color: t.muted, fontSize: 13 }}>{result.workplace.name} · {result.period.label}</Text>
                </View>
              </View>
              {result.lines.map((line) => <Text key={line} style={{ color: t.text2, fontSize: 14.5, lineHeight: 21 }}>{line}</Text>)}
            </Card>

            <Card>
              <Ledger>
                <LedgerRow label={tr("Hours on the payslip")} value={hours(result.slip.hours)} />
                <LedgerRow label={tr("Hours you logged")} value={hours(result.logged.hours)} />
                <LedgerRow label={tr("Difference")} value={hours(result.difference.hours)} kind="total" />
                {result.slip.gross !== null ? <LedgerRow label={tr("Gross on the payslip")} value={money(result.slip.gross)} kind="faint" /> : null}
                {result.logged.gross !== null ? <LedgerRow label={tr("Gross at your rate")} value={money(result.logged.gross)} kind="faint" /> : null}
              </Ledger>
            </Card>

            {result.shifts.length ? (
              <>
                <SectionLabel>{tr("Shifts in that period")}</SectionLabel>
                <Card pad={false}>
                  {result.shifts.map((shift, i) => (
                    <View key={shift.id} style={[styles.shift, { borderBottomColor: t.line, borderBottomWidth: i === result.shifts.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
                      <Text style={{ color: t.text, fontSize: 15, flex: 1 }}>{shift.day}</Text>
                      <Text style={{ color: t.text2, fontSize: 15, fontVariant: ["tabular-nums"] }}>{shift.hm}</Text>
                      <Button title={tr("Open")} size="sm" kind="ghost" onPress={() => router.push(`/shifts/${shift.id}` as never)} accessibilityLabel={tr("Open the shift on {day}", { day: shift.day })} />
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            {result.notes.length ? (
              <View style={[styles.notes, { backgroundColor: t.warnSoft }]}>
                {result.notes.map((note) => <Text key={note} style={{ color: t.text2, fontSize: 13.5, lineHeight: 19 }}>{note}</Text>)}
              </View>
            ) : null}
          </>
        ) : null}
      </Page>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shift: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], minHeight: 52 },
  notes: { gap: sp[2], padding: sp[4], borderRadius: radius.md },
});
