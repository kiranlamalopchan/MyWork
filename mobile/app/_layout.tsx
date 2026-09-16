/**
 * The root: the query cache, who is signed in, and the rule that a signed-out
 * phone sees only the sign-in screens. A tapped notification is followed to
 * the screen its path means.
 */
import "react-native-gesture-handler";
import React, { useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SessionProvider, useSession } from "@/auth/session";
import { Crashed } from "@/ui/Crashed";
import { navigateTo } from "@/nav/paths";
import { notifications } from "@/push/register";
import { loadThemeMode, saveThemeMode, ThemeContext, type ThemeMode, useTheme } from "@/ui/theme";

/** What shows if a screen throws: the error in words and a way back, never a blank page. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <Crashed error={error} retry={retry} />;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// Where the phone can be buzzed at all (not the web, not Expo Go on Android).
notifications()?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

function Guard() {
  const { ready, me } = useSession();
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
  if (!ready) return null;

  // Signed out, only the sign-in screens exist; signed in, everything but.
  // Every screen draws its own app bar (ui/AppBar), so the stack draws none.
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={!!me}>
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
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Guard />
    </GestureHandlerRootView>
  );
}

export default function Root() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <Shell />
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
