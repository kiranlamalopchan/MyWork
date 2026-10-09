/**
 * Private item search, named catalogues and PLU photo search. The selected
 * catalogue stays above search, with upload available from either view.
 */
import React, { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { useCatalogueIdle, useCatalogueSearch, type CatalogueItem } from "@/api/catalogue";
import { Button, Card, Empty, ErrorBanner, Page, PageTitle, Screen, Segments } from "@/ui";

import { tick } from "@/ui/haptics";
import { useLayout } from "@/ui/layout";
import { Select } from "@/ui/Select";
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
  const params = useLocalSearchParams<{ catalogue?: string; view?: string }>();
  const catalogueId = params.catalogue ? Number(params.catalogue) : undefined;
  const [mode, setMode] = useState<"search" | "photo">("search");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const box = useRef<TextInput>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(id);
  }, [typed]);
  const search = useCatalogueSearch(q, catalogueId);
  const idleQuery = useCatalogueIdle(catalogueId);
  const idleData = idleQuery.data;
  const total = idleData?.total;
  const hasPlu = ["plu", "plu_no"].includes(idleData?.catalogue?.code_column.toLowerCase() || "");
  // What the box types to itself, from the list that was imported: a name,
  // then its number, then the next name. An invented example would teach the
  // shape of somebody else's data.
  const examples = React.useMemo(
    () => (idleData?.samples ?? []).flatMap((i) => [spoken(i.title), ...(i.code ? [i.code] : [])]),
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
          placeholder={ghost ? "" : "Search your selected columns"}
          placeholderTextColor={t.muted}
          accessibilityLabel="Search your private catalogue"
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
          <PhotoSearch key={idleData?.catalogue?.id} catalogueId={idleData?.catalogue?.id} />
        </ScrollView>
      </Screen>
    );
  }

  if (params.view === "catalogues") return <Screen section="Items"><Page>
    <PageTitle sub="Separate uploads, saved privately for you.">My items</PageTitle>
    <Segments value="catalogues" onChange={(view) => router.setParams({ view })} options={[{ value: "search", label: "Search" }, { value: "catalogues", label: "My catalogues" }]} />
    <Button title="Upload a new catalogue" icon="add" onPress={() => router.push("/items/import")} />
    {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
    {idleQuery.isLoading ? <SkeletonRows count={3} /> : null}
    {idleData?.catalogues.map((saved) => <Card key={saved.id}><Pressable accessibilityRole="button" onPress={() => { setTyped(""); setQ(""); router.setParams({ catalogue: String(saved.id), view: "search" }); }} style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
      <Ionicons name="folder-outline" size={24} color={t.brandStrong} /><View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: "700", fontSize: 18 }}>{saved.name}</Text><Text style={{ color: t.muted, marginTop: sp[1] }}>{saved.count.toLocaleString()} private items · Tap to search</Text></View><Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable></Card>)}
    {idleData && !idleData.catalogues.length ? <Empty icon="folder-open-outline" title="Your first catalogue" sub="Upload groceries, meat, or any CSV and give it a name." /> : null}
  </Page></Screen>;

  const meta = looking ? "Looking…" : `${count} result${count === 1 ? "" : "s"} for “${q}”`;

  // The box lives above the list, not in it, so it keeps its focus (and
  // the keyboard) as the hero around it folds away and the list appears.
  return (
    <Screen>
      <View style={[layout.column, styles.bar]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: sp[3], width: "100%", marginBottom: sp[3] }}>
          <Text style={[styles.title, { color: t.text }]}>My items</Text>
          <Button title="Upload" icon="add" size="sm" onPress={() => router.push("/items/import")} />
        </View>
        <Segments value="search" onChange={(view) => router.setParams({ view })} options={[{ value: "search", label: "Search" }, { value: "catalogues", label: "My catalogues" }]} />
        {idleData?.catalogues.length ? <View style={{ width: "100%", marginTop: sp[3], marginBottom: sp[3] }}>
          <Text style={{ color: t.muted, marginBottom: sp[2] }}>Search in</Text>
          <Select value={String(idleData.catalogue?.id || "")} options={idleData.catalogues.map((c) => ({ value: String(c.id), label: `${c.name} (${c.count})` }))} label="Search catalogue" onChange={(value) => router.setParams({ catalogue: value })} />
        </View> : null}
        <View style={{ width: "100%", marginTop: idle ? sp[3] : 0 }}>{field}</View>
        {idle && hasPlu ? (
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
            {hasPlu ? <Pressable onPress={() => { tick(); setMode("photo"); }} hitSlop={6} style={styles.metaPhoto}>
              <Ionicons name="camera-outline" size={16} color={t.violet} />
              <Text style={{ color: t.violet, fontWeight: "700", fontSize: 13.5 }}>Photo</Text>
            </Pressable> : null}
          </View>
        )}
        {idleQuery.error ? <ErrorBanner error={idleQuery.error} onRetry={idleQuery.refetch} /> : null}
        {search.error ? <ErrorBanner error={search.error} onRetry={search.refetch} /> : null}
      </View>
      {idle ? <ScrollView contentContainerStyle={[layout.column, { paddingBottom: layout.bottom + sp[6], gap: sp[3] }]}><Text style={{ color: t.muted, fontSize: 13, marginTop: sp[4] }}>{total ? `${total.toLocaleString()} items in ${idleData?.catalogue?.name} · Only you can access this catalogue` : "Your uploads are private to your account"}</Text>{idleData?.samples.length ? <><Text style={{ color: t.text, fontWeight: "700" }}>Browse a few items</Text>{idleData.samples.map((item, index) => <Result key={item.id} item={item} first={index === 0} last={index === idleData.samples.length - 1} onPress={() => router.push(`/plu/${item.id}`)} />)}</> : null}</ScrollView> : (
        <FlatList
          showsVerticalScrollIndicator={false}
          data={looking ? [] : rows}
          keyExtractor={(i) => String(i.id)}
          contentContainerStyle={[layout.column, { paddingBottom: layout.bottom + sp[6] }]}
          onEndReached={() => search.hasNextPage && !search.isFetchingNextPage && search.fetchNextPage()}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            looking || !q ? <SkeletonRows count={7} />
            : <Empty icon="search-outline" title="No matches" sub={`Nothing found for “${q}”. Try fewer words, or a code.`} />
          }
          ListFooterComponent={search.isFetchingNextPage ? <SkeletonRows count={2} style={{ marginTop: sp[3] }} /> : null}
          renderItem={({ item, index }) => <Result item={item} first={index === 0} last={index === rows.length - 1} onPress={() => router.push(`/plu/${item.id}`)} />}
        />
      )}
    </Screen>
  );
}

/** Every signed-in user can upload a private, named catalogue. */
function ImportRow() {
  const t = useTheme();
  const router = useRouter();
  return <Pressable onPress={() => router.push("/items/import" as any)} testID="plu-import" style={[styles.photo, { backgroundColor: t.surface, borderColor: t.line }]}>
    <View style={[styles.photoIcon, { backgroundColor: alpha(t.teal, 0.12) }]}><Ionicons name="cloud-upload" size={20} color={t.teal} /></View>
    <View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: "700", fontSize: 15.5 }}>Upload my items</Text><Text style={{ color: t.muted, fontSize: 13.5 }}>Choose a CSV, then your headings</Text></View>
    <Ionicons name="chevron-forward" size={18} color={t.lineStrong} />
  </Pressable>;
}

/** One code: the number on a blue badge, the description, and the way in. Rows join into one panel. */
function Result({ item, first, last, onPress }: { item: CatalogueItem; first: boolean; last: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Card pad={false} style={[styles.result, !first && { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTopWidth: 0, marginTop: -1 }, !last && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }]}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.surface2 : "transparent", borderTopColor: t.line, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }]}>
        {item.code ? <View style={[styles.badge, { backgroundColor: t.blue, maxWidth: "35%" }]}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 17, fontVariant: ["tabular-nums"] }} numberOfLines={2}>{item.code}</Text>
        </View> : null}
        <Text style={{ color: t.text, fontWeight: "600", fontSize: 16, flex: 1 }} numberOfLines={2}>{item.title}</Text>
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
