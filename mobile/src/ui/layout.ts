/**
 * How much room there is, and what to do with it. One hook every screen
 * can read instead of guessing a phone's width: a small Android phone gets
 * tighter gutters and slightly smaller type; a big phone the defaults; a
 * tablet or a phone on its side keeps the column readable by capping it
 * and centring it. Safe-area insets come along so a list can leave room
 * for the home indicator or Android's gesture bar.
 */
import { Platform, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { gutter as defaultGutter } from "./theme";

/** The widest a column of cards should ever get. */
export const MAX_COLUMN = 680;

export type Layout = {
  width: number;
  height: number;
  /** A narrow phone (under 360pt wide). */
  compact: boolean;
  /** A tablet, a foldable, or a phone on its side (600pt and up). */
  wide: boolean;
  landscape: boolean;
  gutter: number;
  /** Side padding that also centres the column on a wide screen. */
  column: ViewStyle;
  insets: { top: number; bottom: number; left: number; right: number };
  /** Room to leave under the last thing on a page, tab bar and gesture bar included. */
  bottom: number;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 360;
  const wide = width >= 600;
  const gutter = compact ? 14 : wide ? 28 : defaultGutter;
  const side = wide ? Math.max(gutter, (width - MAX_COLUMN) / 2) : gutter;
  const bottom = Platform.OS === "ios" ? 24 : 40 + insets.bottom;
  return {
    width, height, compact, wide, landscape: width > height, gutter,
    column: { paddingLeft: side + insets.left, paddingRight: side + insets.right },
    insets, bottom,
  };
}
