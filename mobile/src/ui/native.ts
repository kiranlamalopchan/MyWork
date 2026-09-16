/**
 * Load an Expo module only when a screen first needs it. Modules imported at
 * the top of a file are resolved as soon as the screen is opened, and an app
 * binary built before the module was added (a phone still running last
 * week's Xcode build) throws "Cannot find native module" and the whole
 * screen goes blank. Resolved on tap instead, the screen shows and only the
 * one button explains itself. Metro only bundles string-literal requires,
 * so the caller passes `() => require("expo-thing")`.
 */
export function native<T>(load: () => T): T {
  try {
    return load();
  } catch (e: any) {
    if (/native module/i.test(String(e?.message))) {
      throw new Error("This build of the app is missing a part it needs. Rebuild it with `npx expo run:ios --device` (or `run:android`) and try again.");
    }
    throw e;
  }
}

/** The same, but `null` when this build lacks the module — for a feature the screen can do without. */
export function nativeOrNull<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}
