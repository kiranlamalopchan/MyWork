/**
 * The site's design tokens (static/css/app.css §1), light and dark, so the
 * app is the same colours as the page in the browser. Read through
 * `useTheme()`, which follows the phone's setting.
 */
import { useColorScheme } from "react-native";

export const light = {
  brand: "#059669",
  brandStrong: "#047857",
  brandSoft: "rgba(5, 150, 105, 0.12)",
  brandInk: "#ffffff",
  danger: "#dc2626",
  dangerSoft: "rgba(220, 38, 38, 0.10)",
  warn: "#b45309",
  bg: "#f6f7f9",
  surface: "#ffffff",
  surface2: "#f4f6f8",
  surface3: "#eaedf1",
  text: "#0f172a",
  text2: "#475569",
  muted: "#64748b",
  line: "#e8ebf0",
  lineStrong: "#d4dae2",
  pill: "#f3f5f9",
  dark: false,
};

export const dark: Theme = {
  brand: "#34d399",
  brandStrong: "#6ee7b7",
  brandSoft: "rgba(52, 211, 153, 0.14)",
  brandInk: "#04231a",
  danger: "#f87171",
  dangerSoft: "rgba(248, 113, 113, 0.13)",
  warn: "#fbbf24",
  bg: "#0b1120",
  surface: "#131c2e",
  surface2: "#18233a",
  surface3: "#1f2c47",
  text: "#e8edf5",
  text2: "#b3c0d4",
  muted: "#8b9bb4",
  line: "#26334d",
  lineStrong: "#35455f",
  pill: "#1c2640",
  dark: true,
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** Spacing and radii, as the site uses them (--sp-*, --r-*). */
export const sp = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;

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
