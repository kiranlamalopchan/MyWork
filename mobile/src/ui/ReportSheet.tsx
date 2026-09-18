/**
 * Reporting something — a notice, a comment, a story, a person — and, in
 * the same breath, blocking whoever posted it. One sheet for all four so
 * the board, the thread, the story viewer and somebody's page all read the
 * same way: pick why, add a line if you want, send. The server (apps.
 * moderation) keeps the report for review and hides the thing once enough
 * people have said so.
 */
import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { safety, useReportReasons, useSafetyChanged, type ReportKind } from "@/api";

import { Button } from "./index";
import { confirm, notify } from "./confirm";
import { success, tick } from "./haptics";
import { radius, sp, useTheme } from "./theme";

export type ReportTarget = {
  kind: ReportKind;
  id: number;
  /** Whose it is — offered for blocking alongside. Not for reporting yourself. */
  username?: string;
  /** A line of it, quoted at the top so you can see what you're reporting. */
  excerpt?: string;
};

// Offered even before the server has answered, so the sheet never opens empty.
const FALLBACK = [
  { value: "spam", label: "Spam or misleading" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech or violence" },
  { value: "sexual", label: "Nudity or sexual content" },
  { value: "other", label: "Something else" },
];

const NOUN: Record<ReportKind, string> = { notice: "notice", comment: "comment", story: "story", user: "person" };

export function ReportSheet({ target, onClose, onBlocked }: { target: ReportTarget | null; onClose: () => void; onBlocked?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reasons = useReportReasons();
  const changed = useSafetyChanged();
  const [reason, setReason] = useState("spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const list = reasons.data?.reasons?.length ? reasons.data.reasons : FALLBACK;
  const open = target !== null;

  const reset = () => { setReason("spam"); setNote(""); setSent(false); setBusy(false); };
  const close = () => { onClose(); setTimeout(reset, 300); };

  const send = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await safety.report(target.kind, target.id, reason, note.trim());
      success();
      setSent(true);
    } catch (e: any) {
      notify("Couldn't report that", e?.message);
    } finally {
      setBusy(false);
    }
  };

  const block = () => {
    if (!target?.username) return;
    const who = target.username;
    confirm(`Block ${who}?`, "Neither of you will see the other's posts, comments or stories, and any friendship ends.", "Block", async () => {
      try {
        await safety.block(who);
        changed();
        close();
        onBlocked?.();
      } catch (e: any) {
        notify("Couldn't block them", e?.message);
      }
    });
  };

  return (
    <Modal transparent visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(10,14,22,0.55)" }]} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + sp[4] }]} testID="report-sheet">
          <View style={[styles.grab, { backgroundColor: t.lineStrong }]} />
          {sent ? (
            <View style={{ alignItems: "center", gap: sp[3], paddingVertical: sp[4] }}>
              <View style={[styles.tick, { backgroundColor: t.brandSoft }]}><Ionicons name="checkmark" size={30} color={t.brand} /></View>
              <Text style={[styles.title, { color: t.text }]}>Thanks for letting us know</Text>
              <Text style={{ color: t.muted, fontSize: 15, textAlign: "center", lineHeight: 21 }}>It's been reported and will be reviewed within 24 hours.</Text>
              {target?.username ? (
                <Button title={`Block ${target.username}`} kind="danger" onPress={block} icon="ban-outline" style={{ alignSelf: "stretch", marginTop: sp[2] }} testID="report-block" />
              ) : null}
              <Button title="Done" kind="plain" onPress={close} style={{ alignSelf: "stretch" }} testID="report-done" />
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: sp[3] }}>
              <Text style={[styles.title, { color: t.text }]}>Report this {target ? NOUN[target.kind] : ""}</Text>
              {target?.excerpt ? (
                <Text style={[styles.excerpt, { color: t.muted, backgroundColor: t.surface2 }]} numberOfLines={3}>{target.excerpt}</Text>
              ) : null}
              <Text style={{ color: t.text2, fontWeight: "600", fontSize: 14 }}>What's wrong with it?</Text>
              <View style={{ gap: sp[2] }}>
                {list.map((r) => {
                  const on = r.value === reason;
                  return (
                    <Pressable key={r.value} onPress={() => { tick(); setReason(r.value); }} testID={`report-reason-${r.value}`} accessibilityRole="radio" accessibilityState={{ selected: on }}
                      style={[styles.reason, { backgroundColor: on ? t.brandSoft : t.surface2, borderColor: on ? t.brand : "transparent" }]}>
                      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? t.brand : t.muted} />
                      <Text style={{ color: t.text, fontSize: 15.5, fontWeight: on ? "700" : "500" }}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Anything else? (optional)"
                placeholderTextColor={t.muted}
                maxLength={300}
                multiline
                style={[styles.note, { backgroundColor: t.surface2, color: t.text }]}
                testID="report-note"
              />
              <Button title="Send report" onPress={send} busy={busy} testID="report-send" />
              {target?.username ? (
                <Pressable onPress={block} style={styles.blockLink} testID="report-block-link">
                  <Ionicons name="ban-outline" size={16} color={t.danger} />
                  <Text style={{ color: t.danger, fontWeight: "600", fontSize: 14.5 }}>Block {target.username} instead</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: sp[5], paddingTop: sp[3], maxHeight: "88%" },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, marginBottom: sp[3] },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  excerpt: { fontSize: 14, lineHeight: 19, padding: sp[3], borderRadius: radius.sm, fontStyle: "italic" },
  reason: { flexDirection: "row", alignItems: "center", gap: sp[3], minHeight: 48, paddingHorizontal: sp[4], borderRadius: radius.md, borderWidth: 1.5 },
  note: { minHeight: 72, borderRadius: radius.md, paddingHorizontal: sp[4], paddingVertical: sp[3], fontSize: 15, textAlignVertical: "top" },
  tick: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  blockLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: sp[2] },
});
