/**
 * The few pieces every screen is made of, drawn the way the site draws
 * them: a face (photo or initial on the person's hue), a card, a button,
 * the row of seven faces to react with, and a tally.
 */
import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import type { Emoji, Person, ReactionTally } from "@/api";

import { hsl, radius, sp, useTheme } from "./theme";

// ---- faces ----------------------------------------------------------------------

export function Avatar({ person, size = 40, live }: { person: Pick<Person, "initial" | "hue" | "photo" | "is_live">; size?: number; live?: boolean }) {
  const t = useTheme();
  const showLive = live ?? person.is_live;
  return (
    <View style={{ width: size, height: size }}>
      {person.photo ? (
        <Image source={{ uri: person.photo }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.initial, { width: size, height: size, borderRadius: size / 2, backgroundColor: hsl(person.hue) }]}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.42 }}>{person.initial}</Text>
        </View>
      )}
      {showLive ? (
        <View style={[styles.dot, { width: size * 0.3, height: size * 0.3, borderRadius: size * 0.15, borderColor: t.surface, backgroundColor: t.brand }]} />
      ) : null}
    </View>
  );
}

// ---- surfaces --------------------------------------------------------------------

export function Card({ children, style, pad = true, testID }: { children: React.ReactNode; style?: ViewStyle; pad?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }, pad && { padding: sp[4] }, style]}>
      {children}
    </View>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[{ flex: 1, backgroundColor: t.bg }, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: t.text }]}>{children}</Text>;
}

export function Sub({ children, style }: { children: React.ReactNode; style?: any }) {
  const t = useTheme();
  return <Text style={[styles.sub, { color: t.muted }, style]}>{children}</Text>;
}

export function Body({ children, style, numberOfLines }: { children: React.ReactNode; style?: any; numberOfLines?: number }) {
  const t = useTheme();
  return <Text style={[styles.body, { color: t.text }, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

export function Empty({ icon, title, sub }: { icon: keyof typeof Ionicons.glyphMap; title: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.surface2 }]}>
        <Ionicons name={icon} size={28} color={t.muted} />
      </View>
      <Text style={[styles.emptyTitle, { color: t.text }]}>{title}</Text>
      {sub ? <Text style={[styles.sub, { color: t.muted, textAlign: "center" }]}>{sub}</Text> : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={t.brand} />
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={[styles.error, { backgroundColor: t.dangerSoft }]}>
      <Text style={{ color: t.danger, flex: 1 }}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={{ color: t.danger, fontWeight: "700" }}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- controls --------------------------------------------------------------------

export function Button({
  title, onPress, kind = "primary", disabled, busy, icon, style,
}: {
  title: string; onPress?: () => void; kind?: "primary" | "plain" | "danger"; disabled?: boolean; busy?: boolean;
  icon?: keyof typeof Ionicons.glyphMap; style?: ViewStyle;
}) {
  const t = useTheme();
  const bg = kind === "primary" ? t.brand : kind === "danger" ? t.dangerSoft : t.surface;
  const ink = kind === "primary" ? t.brandInk : kind === "danger" ? t.danger : t.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === "plain" ? t.line : bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={ink} /> : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={ink} style={{ marginRight: 6 }} /> : null}
          <Text style={{ color: ink, fontWeight: "700", fontSize: 15 }}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[styles.input, { backgroundColor: t.surface, borderColor: t.line, color: t.text }, props.style]}
    />
  );
}

export function IconButton({ icon, onPress, color, size = 22, label }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void; color?: string; size?: number; label?: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
      <Ionicons name={icon} size={size} color={color || t.text2} />
    </Pressable>
  );
}

// ---- reactions -------------------------------------------------------------------

export const EMOJI: Emoji[] = [
  { value: "👍", label: "Like" }, { value: "❤️", label: "Love" }, { value: "🥰", label: "Care" }, { value: "😂", label: "Haha" },
  { value: "😮", label: "Wow" }, { value: "😢", label: "Sad" }, { value: "😡", label: "Angry" },
];

export function EmojiRow({ mine, onPick, choices = EMOJI }: { mine: string; onPick: (emoji: string) => void; choices?: Emoji[] }) {
  const t = useTheme();
  return (
    <View style={styles.emojiRow}>
      {choices.map((e) => (
        <Pressable
          key={e.value}
          onPress={() => onPick(e.value)}
          accessibilityLabel={e.label}
          style={({ pressed }) => [styles.emoji, { backgroundColor: mine === e.value ? t.brandSoft : "transparent", transform: [{ scale: pressed ? 1.2 : 1 }] }]}
        >
          <Text style={{ fontSize: 24 }}>{e.value}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Tally({ tally, onPress }: { tally: ReactionTally; onPress?: () => void }) {
  const t = useTheme();
  if (!tally.total_reactions) return null;
  return (
    <Pressable onPress={onPress} style={styles.tally} hitSlop={6}>
      <Text style={{ fontSize: 14 }}>{tally.reactions.slice(0, 3).map((r) => r.emoji).join("")}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }} numberOfLines={1}>{tally.who_reacted}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  initial: { alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: -1, bottom: -1, borderWidth: 2 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  sub: { fontSize: 13, lineHeight: 18 },
  body: { fontSize: 16, lineHeight: 22 },
  empty: { alignItems: "center", padding: sp[6], gap: sp[2] },
  emptyIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: sp[2] },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  loading: { padding: sp[6], alignItems: "center" },
  error: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.md, margin: sp[4] },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", minHeight: 46, paddingHorizontal: sp[4], borderRadius: radius.md, borderWidth: 1 },
  input: { minHeight: 46, paddingHorizontal: sp[3], paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, fontSize: 16 },
  emojiRow: { flexDirection: "row", justifyContent: "space-between" },
  emoji: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  tally: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
});
