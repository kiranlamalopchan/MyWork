/**
 * Photo search: a picking list photographed, every line on it named as a
 * PLU. Take or choose the photo; the server reads it and says how sure it
 * is of each line and what else it might have meant, so a doubtful row
 * can be put right with a tap — a runner-up, a typed number, or "not on
 * the list" — before the read is saved as a PDF. The read is kept here on
 * the phone; the server holds nothing between calls.
 */
import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";

import { plu, type PhotoRead, type PhotoRow, type PluItem } from "@/api";
import type { FilePart } from "@/api/client";

import { confirm, notify } from "./confirm";
import { success, tick } from "./haptics";
import { Button, Card, Chip, Empty, Input } from "./index";
import { SkeletonRows } from "./Skeleton";
import { openPdf } from "./pdf";
import { alpha, radius, sp, useTheme } from "./theme";

type Row = PhotoRow & { key: number };

export function PhotoSearch() {
  const t = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const shoot = async (from: "camera" | "library") => {
    setError("");
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.9 };
    let result: ImagePicker.ImagePickerResult | null = null;
    try {
      if (from === "camera") {
        if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) { setError("The camera isn't allowed. Choose a photo instead, or allow it in Settings."); return; }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }
    } catch (e: any) {
      setError(e?.message || "That couldn't be opened.");
      return;
    }
    if (!result || result.canceled) return;
    const asset = result.assets[0];
    const name = asset.fileName || "list.jpg", type = asset.mimeType || "image/jpeg";
    setReading(true);
    try {
      const file: FilePart = Platform.OS === "web"
        ? (new File([await (await fetch(asset.uri)).blob()], name, { type }) as unknown as FilePart)
        : { uri: asset.uri, name, type };
      const read: PhotoRead = await plu.photo(file);
      setRows(read.rows.map((r, i) => ({ ...r, key: i })));
      setSkipped(read.skipped);
      setOpen(null);
      success();
    } catch (e: any) {
      setError(e?.message || "The photo couldn't be read.");
    } finally {
      setReading(false);
    }
  };

  const put = (key: number, item: PluItem | null) => {
    tick();
    setRows((rs) => (rs || []).flatMap((r) => (r.key !== key ? [r] : item ? [{ ...r, item, sureness: "picked" as const, score: 1, by_code: false }] : [])));
    setOpen(null);
  };

  const save = async () => {
    if (!rows?.length) return;
    setSaving(true);
    try {
      await openPdf(plu.photoPdfUrl(), "picking-list.pdf", { rows: rows.map((r) => ({ plu_no: r.item.plu_no, line: r.line })) });
      success();
    } catch (e: any) {
      notify("No PDF", e?.message || "");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => confirm("Clear this read?", "The photo's lines go; take another whenever you like.", "Clear", () => { setRows(null); setSkipped(0); setOpen(null); });

  // While the server reads: the shape of the rows to come, breathing.
  if (reading) {
    return (
      <View style={{ gap: sp[3] }}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "800", fontSize: 20, letterSpacing: -0.4 }}>Reading the list…</Text>
            <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>Every line is being matched to a PLU.</Text>
          </View>
        </View>
        <SkeletonRows count={5} />
      </View>
    );
  }

  if (!rows) {
    return (
      <View style={{ gap: sp[3] }}>
        <Empty
          icon="camera"
          title="Photograph a picking list"
          sub="Every line on it comes back named as a PLU, with the doubtful ones marked so you can put them right before saving the list as a PDF."
          action={
            <View style={{ gap: sp[2], alignItems: "center" }}>
              <Button title="Take a photo" icon="camera" onPress={() => shoot("camera")} testID="photo-camera" />
              <Button title="Choose a photo" icon="images-outline" kind="plain" onPress={() => shoot("library")} testID="photo-library" />
            </View>
          }
        />
        {error ? <Text style={{ color: t.danger, fontSize: 14, textAlign: "center" }}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: sp[3] }}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontWeight: "800", fontSize: 20, letterSpacing: -0.4 }}>{rows.length} line{rows.length === 1 ? "" : "s"} read</Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{skipped ? `${skipped} passed over — a name, a date, a note. ` : ""}Tap a doubtful line to put it right.</Text>
        </View>
      </View>
      {error ? <Text style={{ color: t.danger, fontSize: 14 }}>{error}</Text> : null}
      <Card pad={false}>
        {rows.map((row, i) => (
          <RowView key={row.key} row={row} last={i === rows.length - 1} open={open === row.key} onOpen={() => { tick(); setOpen(open === row.key ? null : row.key); }} onPut={(item) => put(row.key, item)} />
        ))}
        {!rows.length ? <Text style={{ color: t.muted, fontSize: 14.5, padding: sp[4], textAlign: "center" }}>Nothing left on the list.</Text> : null}
      </Card>
      <Button title="Save as PDF" icon="download-outline" onPress={save} busy={saving} disabled={!rows.length} testID="photo-pdf" />
      <View style={{ flexDirection: "row", gap: sp[2] }}>
        <Button title="New photo" icon="camera" kind="plain" onPress={() => shoot("camera")} style={{ flex: 1 }} />
        <Button title="Clear" kind="ghost" onPress={clear} style={{ flex: 1 }} testID="photo-clear" />
      </View>
    </View>
  );
}

const SURE: Record<PhotoRow["sureness"], { word: string; key: "brand" | "blue" | "warn" | "violet" }> = {
  sure: { word: "Sure", key: "brand" }, likely: { word: "Likely", key: "blue" }, unsure: { word: "Unsure", key: "warn" }, picked: { word: "Picked", key: "violet" },
};

function RowView({ row, last, open, onOpen, onPut }: { row: Row; last: boolean; open: boolean; onOpen: () => void; onPut: (item: PluItem | null) => void }) {
  const t = useTheme();
  const [typed, setTyped] = useState("");
  const [looking, setLooking] = useState(false);
  const sure = SURE[row.sureness];
  const ink = t[sure.key];

  const byNumber = async () => {
    const n = Number(typed.trim());
    if (!n) return;
    setLooking(true);
    try { onPut(await plu.one(n)); setTyped(""); } catch { notify("No PLU with that number"); } finally { setLooking(false); }
  };

  return (
    <View style={[!last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent" }]} testID={`photo-row-${row.key}`}>
        <View style={[styles.badge, { backgroundColor: t.blue }]}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, fontVariant: ["tabular-nums"] }}>{row.item.plu_no}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 15.5 }} numberOfLines={2}>{row.item.description}</Text>
          <Text style={{ color: t.muted, fontSize: 13, marginTop: 2, fontStyle: "italic" }} numberOfLines={1}>“{row.line}”</Text>
        </View>
        <View style={[styles.sure, { backgroundColor: alpha(ink, 0.12) }]}>
          <Text style={{ color: ink, fontSize: 11.5, fontWeight: "800", letterSpacing: 0.3 }}>{sure.word.toUpperCase()}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.fix, { backgroundColor: t.dark ? t.surface2 : t.bg }]}>
          {row.alternatives.length ? (
            <>
              <Text style={{ color: t.muted, fontSize: 13, fontWeight: "700" }}>Did it mean…</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
                {row.alternatives.map((alt) => <Chip key={alt.plu_no} onPress={() => onPut(alt)}>{alt.plu_no} · {alt.description}</Chip>)}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: "row", gap: sp[2], alignItems: "center" }}>
            <Input value={typed} onChangeText={setTyped} placeholder="Another PLU number" keyboardType="number-pad" style={{ flex: 1 }} onSubmitEditing={byNumber} />
            <Button title="Set" size="sm" onPress={byNumber} busy={looking} disabled={!typed.trim()} />
          </View>
          <Pressable onPress={() => onPut(null)} style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}>
            <Ionicons name="close-circle-outline" size={18} color={t.danger} />
            <Text style={{ color: t.danger, fontWeight: "700", fontSize: 14 }}>Not on the list</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingHorizontal: sp[4], minHeight: 68 },
  badge: { minWidth: 56, paddingHorizontal: 10, height: 36, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  sure: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  fix: { gap: sp[3], padding: sp[4], paddingTop: sp[3] },
});
