/**
 * Shared 60/30/10 colour roles: neutral page, supporting surfaces, one emerald
 * accent. Dark page backgrounds are pure black. Status colours and content
 * artwork retain meaning; legacy decorative colour names reuse the accent.
 * Edit design/tokens/palette.json and run scripts/sync_palette.py.
 */
import { createContext, useContext } from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

import { palettes } from "./palette";

// Shared background, surfaces and accents on web and mobile.
export { palettes } from "./palette";
export const light = palettes.light;
export const dark: Theme = palettes.dark;

export type Theme = typeof light;
export type ThemeMode = "system" | "light" | "dark";

export const ThemeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: "system", setMode: () => {} });

export function useTheme(): Theme {
  const system = useColorScheme();
  const { mode } = useContext(ThemeContext);
  const wantsDark = mode === "system" ? system === "dark" : mode === "dark";
  return wantsDark ? dark : light;
}

/** Appearance in Profile: the current palette and changing it. */
export function useThemeMode() {
  const system = useColorScheme();
  const { mode, setMode } = useContext(ThemeContext);
  const isDark = mode === "system" ? system === "dark" : mode === "dark";
  return { mode, isDark, toggle: () => setMode(isDark ? "light" : "dark") };
}

const KEY = "mywork.theme";

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, mode);
  } catch {
    /* the choice lasts the session then */
  }
}

/** Spacing and radii. */
export const sp = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;

/** The page's side margin. */
export const gutter = 20;

/** The app bar's height, under the status bar — about a system nav bar's, so the page keeps the screen. */
export const APPBAR_H = 48;

/**
 * A person's colour, from their username, the way apps/accounts/avatars.py
 * does it — so a face is the same hue on the phone and on the site.
 */
export function hueFor(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i) * (i + 1);
  return sum % 360;
}

export function hsl(h: number, s = 62, l = 46): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** `color-mix(in srgb, <hex> <pct>%, transparent)` for a #rrggbb colour. */
export function alpha(hex: string, a: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

/**
 * `color-mix(in srgb, <a> <pct>%, <b>)` — an opaque blend of two hexes.
 *
 * Not the same thing as alpha(): a tinted panel has to be a colour of its
 * own, because what is under it on a screen is the page and what is under it
 * on the site is the card, and a translucent tint would come out differently
 * on each. This is how the site paints the same panel, so both agree.
 */
export function mix(a: string, b: string, amount: number): string {
  const parse = (hex: string) => hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const [ma, mb] = [parse(a), parse(b)];
  if (!ma || !mb) return b;
  const at = (m: RegExpMatchArray, i: number) => parseInt(m[i], 16);
  const blend = (i: number) => Math.round(at(ma, i) * amount + at(mb, i) * (1 - amount));
  return `#${[1, 2, 3].map((i) => blend(i).toString(16).padStart(2, "0")).join("")}`;
}
