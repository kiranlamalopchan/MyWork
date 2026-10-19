import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CatalogueItem } from "@/api/catalogue";
import { sp, useTheme } from "./theme";
export type ProductHistory = { favorites: CatalogueItem[]; recent: CatalogueItem[] };
export function SavedProducts({ history, catalogueId, onOpen, onFavorite }: {
  history: ProductHistory; catalogueId?: number; onOpen: (item: CatalogueItem) => void; onFavorite: (item: CatalogueItem) => void;
}) {
  const t = useTheme();
  const sections = ([['Favourites', history.favorites], ['Recently used', history.recent]] as const)
    .map(([label, items]) => ({ label, rows: items.filter(row => row.catalogue_id === catalogueId).slice(0, 5) }));
  if (!sections.some(section => section.rows.length)) return null;
  return <View style={{ gap: sp[2] }}>
    {sections.map(({ label, rows }) => {
      return rows.length ? <View key={label} style={{ gap: sp[2] }}>
        <Text style={{ color: t.muted, fontWeight: '700' }}>{label}</Text>
        {rows.map(item => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp[2] }}>
          <Pressable onPress={() => onOpen(item)} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 6 }}><Text style={{ color: t.text }}>{item.code} · {item.title}</Text></Pressable>
          <Pressable onPress={() => onFavorite(item)} accessibilityRole="button" accessibilityLabel={history.favorites.some(row => row.id === item.id) ? 'Remove favourite' : 'Save favourite'} style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={history.favorites.some(row => row.id === item.id) ? 'star' : 'star-outline'} color={t.brand} size={21} /></Pressable>
        </View>)}
      </View> : null;
    })}
  </View>;
}
