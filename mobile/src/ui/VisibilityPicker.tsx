/**
 * Who sees it — the same three choices everywhere a notice or a comment is
 * written: Public, Friends only, Only me. One small component so choosing
 * "Friends only" means the same thing on the composer and in the reply box.
 */
import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import type { Visibility } from "@/api";

import { Segments } from "./index";
import { tick } from "./haptics";
import { useTheme } from "./theme";

const OPTIONS: { value: Visibility; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "public", label: "Public", icon: "globe-outline" },
  { value: "friends", label: "Friends", icon: "people-outline" },
  { value: "private", label: "Only me", icon: "lock-closed-outline" },
];

export function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return <Segments value={value} onChange={onChange} options={OPTIONS} />;
}

/** The small mark on a posted notice or comment — nothing shown for Public,
 * since that's the common case and needs no explaining. */
export function VisibilityBadge({ visibility, size = 13 }: { visibility: Visibility; size?: number }) {
  const t = useTheme();
  if (visibility === "public") return null;
  const icon = visibility === "friends" ? "people-outline" : "lock-closed-outline";
  const label = visibility === "friends" ? "Friends only" : "Only me";
  return (
    <View accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center" }}>
      <Ionicons name={icon} size={size} color={t.muted} />
    </View>
  );
}

const CYCLE: Visibility[] = ["public", "friends", "private"];
const ICONS: Record<Visibility, keyof typeof Ionicons.glyphMap> = {
  public: "globe-outline", friends: "people-outline", private: "lock-closed-outline",
};
const LABELS: Record<Visibility, string> = { public: "Public", friends: "Friends only", private: "Only me" };

/**
 * A compact stand-in for the full picker, for a reply box with no room for
 * three labelled tabs: one icon that names the current audience and cycles
 * to the next on tap, the same order the full picker lists them in.
 */
export function VisibilityToggle({ value, onChange, size = 34 }: { value: Visibility; onChange: (v: Visibility) => void; size?: number }) {
  const t = useTheme();
  const next = () => { tick(); onChange(CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length]); };
  return (
    <Pressable
      onPress={next}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Visible to: ${LABELS[value]}. Tap to change.`}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: t.dark ? t.surface3 : t.surface2 }}
    >
      <Ionicons name={ICONS[value]} size={16} color={value === "public" ? t.text2 : t.brand} />
    </Pressable>
  );
}
