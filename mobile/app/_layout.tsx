/**
 * The root: the query cache, who is signed in, and the rule that a signed-out
 * phone sees only the sign-in screens. A tapped notification is followed to
 * the screen its path means.
 */
import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SessionProvider, useSession } from "@/auth/session";
import { OnboardingProvider, useOnboarding } from "@/onboarding/seen";
import { Crashed } from "@/ui/Crashed";
import { Splash } from "@/ui/Splash";
import { navigateTo } from "@/nav/paths";
import { nativeOrNull } from "@/ui/native";
import { notifications } from "@/push/register";
import { loadThemeMode, saveThemeMode, ThemeContext, type ThemeMode, useTheme } from "@/ui/theme";

/** What shows if a screen throws: the error in words and a way back, never a blank page. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <Crashed error={error} retry={retry} />;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: Platform.OS !== "web" } } });

// TanStack's "window focus" is a browser idea; on a phone it is the app
// coming back to the front, which is when the board and the inbox should
// be asked again.
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
}

// The still stays up until ui/Splash has painted over it; a build without the
// module simply never had one to hold.
nativeOrNull(() => require("expo-splash-screen"))?.preventAutoHideAsync?.()?.catch?.(() => {});

// Where the phone can be buzzed at all (not the web, not Expo Go on Android).
notifications()?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

function Guard() {
  const { ready, me } = useSession();
  const { checked, seen } = useOnboarding();
  const t = useTheme();

  // A notification tapped: cold start or while running, the same path.
  useEffect(() => {
    const Notifications = notifications();
    if (!Notifications || !me) return;
    const follow = (response: { notification: { request: { content: { data?: Record<string, unknown> } } } } | null) => {
      const url = response?.notification.request.content.data?.url;
      if (typeof url === "string") navigateTo(url).catch(() => {});
    };
    Notifications.getLastNotificationResponseAsync().then(follow).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(follow);
    return () => sub.remove();
  }, [me]);

  // Nothing until the keychain has been asked: the splash stays up that long.
  if (!ready || !checked) return null;

  // Somebody already signed in has been here before, whatever the flag says —
  // an update should not hand a regular a tour of their own app.
  const tour = !seen && !me;

  // The way in first if it is owed, then the sign-in screens while signed
  // out, then everything else. Every screen draws its own app bar
  // (ui/AppBar), so the stack draws none.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Protected guard={tour}>
        {/* Faded, not pushed: the splash is dissolving into this. */}
        <Stack.Screen name="(onboarding)" options={{ animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!tour && !me}>
        <Stack.Screen name="(auth)" options={{ animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={!tour && !!me}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="board" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="notices/compose" options={{ presentation: "modal" }} />
        <Stack.Screen name="notices/[id]/index" />
        <Stack.Screen name="notices/[id]/reactions" options={{ presentation: "modal" }} />
        <Stack.Screen name="people/[username]" />
        <Stack.Screen name="stories/[username]" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="stories/compose" options={{ presentation: "modal" }} />
        <Stack.Screen name="profile/index" />
        <Stack.Screen name="profile/edit" />
        <Stack.Screen name="profile/delete" />
        <Stack.Screen name="plu/[plu_no]" />
        <Stack.Screen name="holidays" />
        <Stack.Screen name="shifts/new" />
        <Stack.Screen name="shifts/[id]/index" />
        <Stack.Screen name="shifts/[id]/edit" />
        <Stack.Screen name="workplaces/index" />
        <Stack.Screen name="workplaces/new" />
        <Stack.Screen name="workplaces/[id]/edit" />
        <Stack.Screen name="workplaces/[id]/remove" />
        <Stack.Screen name="pay" />
      </Stack.Protected>
    </Stack>
  );
}

/** The day/night choice, kept between runs the way the site keeps its cookie. */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => { loadThemeMode().then(setModeState); }, []);
  const value = useMemo(() => ({
    mode,
    setMode: (next: ThemeMode) => { setModeState(next); saveThemeMode(next).catch(() => {}); },
  }), [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function Shell() {
  const t = useTheme();
  const { ready } = useSession();
  const { checked } = useOnboarding();
  const [wayIn, setWayIn] = useState(true);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* The splash is navy whichever way the phone is set. */}
      <StatusBar style={wayIn || t.dark ? "light" : "dark"} />
      <Guard />
      {wayIn ? <Splash ready={ready && checked} onDone={() => setWayIn(false)} /> : null}
    </GestureHandlerRootView>
  );
}

export default function Root() {
  // A development build's tooling (expo's withDevTools) holds the screen
  // awake, so the phone never dims or locks while the app is open — which
  // is not how the app behaves once built for real. Let the phone have its
  // way, once the tooling has taken hold. A release build has none of this.
  useEffect(() => {
    if (!__DEV__) return;
    const id = setTimeout(() => {
      const KeepAwake = nativeOrNull(() => require("expo-keep-awake") as typeof import("expo-keep-awake"));
      KeepAwake?.deactivateKeepAwake(KeepAwake.ExpoKeepAwakeTag).catch(() => {});
    }, 1000);
    return () => clearTimeout(id);
  }, []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <OnboardingProvider>
            <Shell />
          </OnboardingProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
