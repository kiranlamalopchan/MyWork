/**
 * The app in English or in Nepali.
 *
 * The English sentence is the key. A screen writes `tr("Clock in")` and
 * reads as it always did; the Nepali for it is looked up in ne.ts, and a
 * sentence nobody has translated yet simply stays in English rather than
 * showing a key or a blank. Words inside a sentence go in braces:
 * `tr("Showing {shown} of {total}", { shown, total })`.
 *
 * What the server words — a notification, a refusal — arrives already
 * written and is shown as it came.
 */
import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

import { ne } from "./ne";

export type Lang = "en" | "ne";
export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ne", label: "नेपाली" },
];

const KEY = "mywork.lang";
let current: Lang = "en";
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

function apply(lang: Lang) {
  if (lang === current) return;
  current = lang;
  for (const listener of listeners) listener();
}

/** Read the saved choice at start-up; English until it is known. */
export async function loadLang(): Promise<Lang> {
  try {
    const saved = await SecureStore.getItemAsync(KEY);
    if (saved === "en" || saved === "ne") apply(saved);
  } catch {
    /* English it is */
  }
  return current;
}

export function setLang(lang: Lang): void {
  apply(lang);
  SecureStore.setItemAsync(KEY, lang).catch(() => { /* the choice lasts this run */ });
}

export function tr(text: string, vars?: Record<string, string | number>): string {
  const sentence = current === "ne" ? ne[text] ?? text : text;
  if (!vars) return sentence;
  return sentence.replace(/\{(\w+)\}/g, (whole: string, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** `tr`, for a component: it draws again when the language changes. */
export function useT(): typeof tr {
  useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getLang,
  );
  return tr;
}
