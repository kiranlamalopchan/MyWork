/**
 * The app's design tokens, light and dark. The colours are the site's — the
 * brand green, the reactions' inks, a person's hue from their username — on
 * a calm, flat modern ground: solid panels, no gradients, bigger radii,
 * softer shadows. Read
 * through `useTheme()`. As on the site, the phone's setting decides unless
 * the person has flicked the day/night switch in the app bar; that choice
 * is kept (`setThemeMode`) the way the site keeps its cookie.
 */
import { createContext, useContext } from "react";
import { Platform, useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

export const light = {
  brand: "#059669",
  brandStrong: "#047857",
  brandSoft: "rgba(5, 150, 105, 0.12)",
  brandInk: "#ffffff",
  // The solid deep green a hero card is painted, and its ink.
  hero: "#047857",
  heroInk: "#ffffff",
  heroSoft: "rgba(255, 255, 255, 0.78)",
  heroChip: "rgba(255, 255, 255, 0.18)",
  danger: "#e11d48",
  dangerSoft: "rgba(225, 29, 72, 0.10)",
  warn: "#c2410c",
  warnSoft: "rgba(194, 65, 12, 0.11)",
  // The accents the icon tiles are coded in.
  blue: "#2563eb",
  violet: "#7c3aed",
  orange: "#ea580c",
  pink: "#db2777",
  teal: "#0d9488",
  rxLike: "#1b74e4",
  rxLove: "#e0243f",
  rxFace: "#b7791f",
  rxAngry: "#d9482a",
  bg: "#f2f3f6",
  surface: "#ffffff",
  surface2: "#f3f4f7",
  surface3: "#e8eaef",
  text: "#0f1420",
  text2: "#3f4756",
  muted: "#6b7385",
  line: "#e6e8ee",
  lineStrong: "#d3d7e0",
  pill: "#f3f4f7",
  pillGlass: "rgba(255, 255, 255, 0.72)",
  pillLine: "rgba(255, 255, 255, 0.9)",
  track: "rgba(15, 20, 32, 0.07)",
  knob: "#ffffff",
  // Panels are solid now; these stay for anything that still asks for glass.
  glass: "#ffffff",
  glassLine: "rgba(15, 20, 32, 0.05)",
  glassHi: "transparent",
  shadow: "#1a2540",
  // Kept for anything that still asks for the old ambient washes; the page is flat now.
  amb1: "transparent",
  amb2: "transparent",
  amb3: "transparent",
  dark: false,
};

export const dark: Theme = {
  brand: "#34d399",
  brandStrong: "#6ee7b7",
  brandSoft: "rgba(52, 211, 153, 0.15)",
  brandInk: "#04231a",
  hero: "#065f46",
  heroInk: "#ffffff",
  heroSoft: "rgba(255, 255, 255, 0.78)",
  heroChip: "rgba(255, 255, 255, 0.16)",
  danger: "#fb7185",
  dangerSoft: "rgba(251, 113, 133, 0.14)",
  warn: "#fb923c",
  warnSoft: "rgba(251, 146, 60, 0.14)",
  blue: "#60a5fa",
  violet: "#a78bfa",
  orange: "#fb923c",
  pink: "#f472b6",
  teal: "#2dd4bf",
  rxLike: "#5aa0f2",
  rxLove: "#f5607a",
  rxFace: "#f2c14e",
  rxAngry: "#f2795c",
  bg: "#0a0c12",
  surface: "#161a24",
  surface2: "#1e2330",
  surface3: "#28303f",
  text: "#f1f3f8",
  text2: "#c3cad8",
  muted: "#8d97ab",
  line: "#252b39",
  lineStrong: "#343c4d",
  pill: "#1e2330",
  pillGlass: "rgba(30, 35, 48, 0.72)",
  pillLine: "rgba(255, 255, 255, 0.12)",
  track: "rgba(255, 255, 255, 0.10)",
  knob: "#3a4356",
  glass: "#161a24",
  glassLine: "rgba(255, 255, 255, 0.07)",
  glassHi: "transparent",
  shadow: "#000000",
  amb1: "transparent",
  amb2: "transparent",
  amb3: "transparent",
  dark: true,
};

export type Theme = typeof light;
export type ThemeMode = "system" | "light" | "dark";

export const ThemeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: "system", setMode: () => {} });

export function useTheme(): Theme {
  const system = useColorScheme();
  const { mode } = useContext(ThemeContext);
  const wantsDark = mode === "system" ? system === "dark" : mode === "dark";
  return wantsDark ? dark : light;
}

/** The switch in the app bar: where it sits, and flicking it. */
export function useThemeMode() {
  const system = useColorScheme();
  const { mode, setMode } = useContext(ThemeContext);
  const isDark = mode === "system" ? system === "dark" : mode === "dark";
  return { mode, isDark, toggle: () => setMode(isDark ? "light" : "dark") };
}

const KEY = "mywork.theme";

export async function loadThemeMode(): Promise<ThemeMode> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, mode);
    else await SecureStore.setItemAsync(KEY, mode);
  } catch {
    /* the choice lasts the session then */
  }
}

/** Spacing and radii. */
export const sp = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const radius = { sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** The page's side margin. */
export const gutter = 20;

/** The app bar's height, under the status bar. */
export const APPBAR_H = 56;

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
