import React from "react";
import { Pressable, Text } from "react-native";
import { FoldChevron } from "./Disclosure";
import { sp, useTheme } from "./theme";

/** Native equivalent of the website's two-notice disclosure. */
export function NoticeFold({ expanded, count, onPress }: { expanded: boolean; count: number; onPress: () => void }) {
  const t = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ expanded }} testID="notice-fold"
    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: sp[2], minHeight: 44, paddingHorizontal: sp[3], borderRadius: 14, backgroundColor: pressed ? t.surface2 : "transparent" })}>
    <FoldChevron open={expanded} size={16} colour={t.brandStrong} />
    <Text style={{ color: t.brandStrong, fontSize: 13.5, fontWeight: "600" }}>{expanded ? "Show fewer" : `Show ${count} more notice${count === 1 ? "" : "s"}`}</Text>
  </Pressable>;
}
