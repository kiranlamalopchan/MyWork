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
  return <View style={{ gap: sp[2], marginTop: sp[3] }}>
    {([['Favourites', history.favorites], ['Recently used', history.recent]] as const).map(([label, items]) => {
      const rows = items.filter(row => row.catalogue_id === catalogueId).slice(0, 5);
      return rows.length ? <View key={label} style={{ gap: sp[2] }}>
        <Text style={{ color: t.muted, fontWeight: '700' }}>{label}</Text>
        {rows.map(item => <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp[2] }}>
          <Pressable onPress={() => onOpen(item)} style={{ flex: 1, paddingVertical: 6 }}><Text style={{ color: t.text }}>{item.code} · {item.title}</Text></Pressable>
          <Pressable onPress={() => onFavorite(item)} accessibilityLabel={history.favorites.some(row => row.id === item.id) ? 'Remove favourite' : 'Save favourite'} hitSlop={8}><Ionicons name={history.favorites.some(row => row.id === item.id) ? 'star' : 'star-outline'} color={t.brand} size={21} /></Pressable>
        </View>)}
      </View> : null;
    })}
  </View>;
}
