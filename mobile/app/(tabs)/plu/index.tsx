/**
 * PLU lookup. Until you type, the search sits in the middle of the screen
 * — a tile, the count of codes, the box, and the way to Photo beneath it.
 * The first letter lifts the box to the top and the codes fill in under
 * it as they come, ranked the way the scale wants them, with their shapes
 * breathing while the server looks. Photo reads a picking list
 * (PhotoSearch) and has a way back to Search.
 */
import React, { useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { plu as pluApi, usePluChanged, usePluIdle, usePluImportable, usePluSearch, type PluItem } from "@/api";
import type { FilePart } from "@/api/client";
import { Card, Empty, ErrorBanner, Screen } from "@/ui";

import { notify } from "@/ui/confirm";
import { fail, success, tick } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { native } from "@/ui/native";
import { PhotoSearch } from "@/ui/PhotoSearch";
import { SkeletonRows } from "@/ui/Skeleton";
import { TypedPlaceholder } from "@/ui/TypedPlaceholder";
import { alpha, radius, sp, useTheme } from "@/ui/theme";

/**
 * A description as somebody would type it.
 *
 * Import files shout — "LAMB LEG CHOPS" — and a box appearing to type in
 * capitals reads as a label again rather than as a person searching. A name
 * that already has a case of its own is left alone.
 */
function spoken(description: string): string {
  return description === description.toUpperCase() ? description.toLowerCase() : description;
}

export default function Plu() {
  const t = useTheme();
  const layout = useLayout();
  const router = useRouter();
  const [mode, setMode] = useState<"search" | "photo">("search");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const box = useRef<TextInput>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);
  const search = usePluSearch(q);
  const idleData = usePluIdle().data;
  const total = idleData?.total;
  // What the box types to itself, from the list that was imported: a name,
  // then its number, then the next name. An invented example would teach the
  // shape of somebody else's data.
  const examples = React.useMemo(
    () => (idleData?.samples ?? []).flatMap((i) => [spoken(i.description), String(i.plu_no)]),
    [idleData],
  );
  const rows = search.data?.pages.flatMap((p) => p.results) ?? [];
  const count = search.data?.pages[0]?.count ?? 0;
  const looking = !!q && search.isLoading;
  const idle = !typed.trim();
  // The box types to itself only while nobody else is using it — and only if
  // the server had rows to give it. Without them the plain placeholder
  // stands, rather than an empty box with nothing in it at all.
  const ghost = !typed && !on && examples.length > 0;

  const field = (
    <View style={[styles.field, { backgroundColor: t.surface }, !t.dark && styles.fieldShadow, !t.dark && { shadowColor: t.shadow }]}>
      <Ionicons name="search-outline" size={22} color={t.muted} />
      <View style={{ flex: 1, justifyContent: "center" }}>
        <TextInput
          ref={box}
          value={typed}
          onChangeText={setTyped}
          onFocus={() => setOn(true)}
          onBlur={() => setOn(false)}
          // The real placeholder is empty while the typed one is running, or
          // the two would sit on top of each other; it comes back the moment
          // the animation stands down.
          placeholder={ghost ? "" : "PLU number or description"}
          placeholderTextColor={t.muted}
          accessibilityLabel="Search PLU by number or description"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          testID="plu-q"
          style={[styles.input, { color: t.text }]}
        />
        <TypedPlaceholder show={ghost} prefix="Search " phrases={examples} style={{ fontSize: 17, color: t.muted }} />
      </View>
      {typed ? (
        <Pressable onPress={() => { tick(); setTyped(""); box.current?.focus(); }} accessibilityLabel="Clear search" style={[styles.clear, { backgroundColor: t.surface3 }]}>
          <Ionicons name="close" size={18} color={t.text2} />
        </Pressable>
      ) : null}
    </View>
  );

  if (mode === "photo") {
    return (
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[layout.column, { paddingTop: sp[3], gap: sp[4], paddingBottom: layout.bottom + sp[6] }]}>
          <View style={styles.photoHead}>
            <Pressable onPress={() => { tick(); setMode("search"); }} accessibilityLabel="Back to search" style={({ pressed }) => [styles.back, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="chevron-back" size={18} color={t.text} />
              <Text style={{ color: t.text, fontWeight: "700", fontSize: 15 }}>Search</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.photoTitle, { color: t.text }]}>Photo search</Text>
            </View>
          </View>
          <PhotoSearch />
        </ScrollView>
      </Screen>
    );
  }

  const meta = looking ? "Looking…" : `${count} result${count === 1 ? "" : "s"} for “${q}”`;

  // The box lives above the list, not in it, so it keeps its focus (and
  // the keyboard) as the hero around it folds away and the list appears.
  return (
    <Screen>
      <View style={[layout.column, styles.bar, idle && styles.middle]}>
        {idle ? (
          <>
            <View style={[styles.tile, { backgroundColor: t.blue }]}>
              <Ionicons name="pricetag" size={34} color="#fff" />
            </View>
            <Text style={[styles.title, { color: t.text }]}>PLU lookup</Text>
            <Text style={[styles.sub, { color: t.muted }]}>{total ? `${total.toLocaleString()} codes` : "Every code"} · by number or description</Text>
          </>
        ) : null}
        <View style={{ width: "100%", marginTop: idle ? sp[3] : 0 }}>{field}</View>
        {idle ? (
          <Pressable onPress={() => { tick(); setMode("photo"); }} testID="plu-photo" style={({ pressed }) => [styles.photo, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent", opacity: pressed ? 0.8 : 1 }, !t.dark && styles.fieldShadow, !t.dark && { shadowColor: t.shadow }]}>
            <View style={[styles.photoIcon, { backgroundColor: alpha(t.violet, 0.12) }]}>
              <Ionicons name="camera" size={20} color={t.violet} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: t.text, fontWeight: "700", fontSize: 15.5 }}>Photo</Text>
              <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 1 }} numberOfLines={2}>Photograph a picking list and get every line named</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
          </Pressable>
        ) : null}
        {idle ? <ImportRow /> : null}
        {idle ? null : (
          <View style={styles.metaRow}>
            <Text style={{ color: t.muted, fontSize: 14, flex: 1 }} numberOfLines={1}>{meta}</Text>
            <Pressable onPress={() => { tick(); setMode("photo"); }} hitSlop={6} style={styles.metaPhoto}>
              <Ionicons name="camera-outline" size={16} color={t.violet} />
              <Text style={{ color: t.violet, fontWeight: "700", fontSize: 13.5 }}>Photo</Text>
            </Pressable>
          </View>
        )}
        {search.error ? <ErrorBanner error={search.error} onRetry={search.refetch} /> : null}
      </View>
      {idle ? null : (
        <FlatList
          showsVerticalScrollIndicator={false}
          data={looking ? [] : rows}
          keyExtractor={(i) => String(i.plu_no)}
          contentContainerStyle={[layout.column, { paddingBottom: layout.bottom + sp[6] }]}
          onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            looking || !q ? <SkeletonRows count={7} />
            : <Empty icon="search-outline" title="No matches" sub={`Nothing found for “${q}”. Try fewer words, or just the number.`} />
          }
          ListFooterComponent={search.isFetchingNextPage ? <SkeletonRows count={2} style={{ marginTop: sp[3] }} /> : null}
          renderItem={({ item, index }) => <Result item={item} first={index === 0} last={index === rows.length - 1} onPress={() => router.push(`/plu/${item.plu_no}`)} />}
        />
      )}
    </Screen>
  );
}

/**
 * The manager's way in: the site's staff-only CSV import (`plu:import`), as a
 * row under Photo. The server says who may see it and says so again when the
 * file lands, so a stale answer on the phone can't let anything through.
 */
function ImportRow() {
  const t = useTheme();
  const may = usePluImportable();
  const changed = usePluChanged();
  const [sent, setSent] = useState<number | null>(null);

  if (!may.data?.allowed) return null;

  const busy = sent !== null;

  const pick = async () => {
    tick();
    try {
      // Loaded on tap, so a build made before the picker still shows the page.
      const DocumentPicker = native<typeof import("expo-document-picker")>(() => require("expo-document-picker"));
      // Phones are vague about what a .csv is, so the net is wide and the
      // server is what actually decides whether the file can be read.
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "text/plain", "*/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const file: FilePart = Platform.OS === "web"
        ? ((asset as any).file
            || new File([await (await fetch(asset.uri)).blob()], asset.name, { type: asset.mimeType || "text/csv" })) as unknown as FilePart
        : { uri: asset.uri, name: asset.name, type: asset.mimeType || "text/csv" };

      setSent(0);
      const done = await pluApi.importCsv(file, setSent);
      changed();
      success();
      notify(
        "Import complete",
        `Created ${done.created}, updated ${done.updated}, skipped ${done.skipped}. ${done.total.toLocaleString()} codes now.`,
      );
    } catch (e: any) {
      fail();
      notify("That didn't import", e?.message || "The file couldn't be used.");
    } finally {
      setSent(null);
    }
  };

  return (
    <Pressable
      onPress={busy ? undefined : pick}
      disabled={busy}
      testID="plu-import"
      style={({ pressed }) => [
        styles.photo,
        { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent", opacity: busy ? 0.6 : pressed ? 0.8 : 1 },
        !t.dark && styles.fieldShadow,
        !t.dark && { shadowColor: t.shadow },
      ]}
    >
      <View style={[styles.photoIcon, { backgroundColor: alpha(t.teal, 0.12) }]}>
        <Ionicons name="cloud-upload" size={20} color={t.teal} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 15.5 }}>Import CSV</Text>
        <Text style={{ color: t.muted, fontSize: 13.5, marginTop: 1 }} numberOfLines={2}>
          {busy
            ? `Uploading ${Math.round((sent ?? 0) * 100)}%…`
            : `Replace the list from a file with ${(may.data.headers || []).join(" and ")}`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
    </Pressable>
  );
}

/** One code: the number on a blue badge, the description, and the way in. Rows join into one panel. */
function Result({ item, first, last, onPress }: { item: PluItem; first: boolean; last: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card pad={false} style={[styles.result, !first && { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, marginTop: -1 }, !last && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent", borderTopColor: t.line, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }]}>
        <View style={[styles.badge, { backgroundColor: t.blue }]}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17, fontVariant: ["tabular-nums"] }}>{item.plu_no}</Text>
        </View>
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, flex: 1 }} numberOfLines={2}>{item.description}</Text>
        <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  middle: { flex: 1, justifyContent: "center", alignItems: "center", gap: sp[2], paddingBottom: sp[8] },
  tile: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: sp[2] },
  title: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, lineHeight: 36 },
  sub: { fontSize: 15, textAlign: "center" },
  field: { flexDirection: "row", alignItems: "center", gap: sp[2], height: 56, paddingLeft: sp[4], paddingRight: 8, borderRadius: radius.pill },
  fieldShadow: { shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  input: { flex: 1, fontSize: 17, height: 52 },
  clear: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  photo: { width: "100%", flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], paddingRight: sp[4], borderRadius: radius.lg, borderWidth: 1, marginTop: sp[4] },
  photoIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  photoHead: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  photoTitle: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 8, paddingRight: 14, height: 38, borderRadius: radius.pill },
  bar: { paddingTop: sp[3], paddingBottom: sp[3] },
  metaRow: { flexDirection: "row", alignItems: "center", gap: sp[3], marginTop: sp[3], paddingHorizontal: 4 },
  metaPhoto: { flexDirection: "row", alignItems: "center", gap: 5 },
  result: { borderRadius: radius.lg },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingHorizontal: sp[4], minHeight: 64 },
  badge: { minWidth: 62, paddingHorizontal: 10, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
});
