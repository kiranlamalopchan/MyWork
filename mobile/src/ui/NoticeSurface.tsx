import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { Notice } from "@/api";
import { Card } from "./index";
import { alpha, radius, useTheme } from "./theme";

/** The same author wash, own-post rail and pinned outline as the website. */
export function NoticeSurface({ notice, children, style, onPress }: {
  notice: Pick<Notice, "id" | "author" | "mine" | "is_new" | "pinned">;
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  const t = useTheme();
  const tint = `hsla(${notice.author.hue}, 72%, 52%, ${notice.is_new ? 0.42 : 0.3})`;
  return <Card pad={false} testID={`notice-${notice.id}`} onPress={onPress}
    accessibilityLabel={onPress ? `Open post by ${notice.mine ? "you" : notice.author.username}` : undefined}
    style={[
      { borderRadius: radius.xl, borderColor: notice.mine ? t.line : tint },
      notice.mine && { borderLeftWidth: 3, borderLeftColor: t.brand },
      notice.pinned && { borderWidth: 1.5, borderColor: alpha(t.brand, 0.55) },
      style,
    ]}>
    {!notice.mine ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      borderRadius: radius.xl - 1, backgroundColor: `hsla(${notice.author.hue}, 72%, 52%, ${t.dark ? 0.14 : 0.09})`,
    }]} /> : null}
    {children}
  </Card>;
}
