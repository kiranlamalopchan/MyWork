import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import type { Notice } from "@/api";
import { Card } from "./index";
import { alpha, radius, useTheme } from "./theme";

/** A notice's card, as on the website: plain — no author wash, no own-post
 *  rail — with only the pinned outline to mark it. */
export function NoticeSurface({ notice, children, style, onPress }: {
  notice: Pick<Notice, "id" | "author" | "mine" | "is_new" | "pinned">;
  children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void;
}) {
  const t = useTheme();
  return <Card pad={false} testID={`notice-${notice.id}`} onPress={onPress}
    accessibilityLabel={onPress ? `Open post by ${notice.mine ? "you" : notice.author.username}` : undefined}
    style={[
      { borderRadius: radius.xl, borderColor: t.line },
      notice.pinned && { borderWidth: 1.5, borderColor: alpha(t.brand, 0.55) },
      style,
    ]}>
    {children}
  </Card>;
}
