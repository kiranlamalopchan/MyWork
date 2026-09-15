/**
 * The root: the query cache, who is signed in, and the rule that a signed-out
 * phone sees only the sign-in screens. A tapped notification is followed to
 * the screen its path means.
 */
import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";

import { SessionProvider, useSession } from "@/auth/session";
import { navigateTo } from "@/nav/paths";
import { useTheme } from "@/ui/theme";

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

function Guard() {
  const { ready, me } = useSession();
  const t = useTheme();

  // A notification tapped: cold start or while running, the same path.
  useEffect(() => {
    if (Platform.OS === "web" || !me) return;
    const follow = (response: Notifications.NotificationResponse | null) => {
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
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: t.surface }, headerTintColor: t.text, headerShadowVisible: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="notices/compose" options={{ title: "New notice", presentation: "modal" }} />
        <Stack.Screen name="notices/[id]/index" options={{ title: "Notice" }} />
        <Stack.Screen name="notices/[id]/reactions" options={{ title: "Reactions", presentation: "modal" }} />
        <Stack.Screen name="people/[username]" options={{ title: "" }} />
        <Stack.Screen name="stories/[username]" options={{ headerShown: false, presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="stories/compose" options={{ title: "Create story", presentation: "modal" }} />
        <Stack.Screen name="profile/edit" options={{ title: "Edit profile" }} />
        <Stack.Screen name="plu/[plu_no]" options={{ title: "PLU" }} />
        <Stack.Screen name="holidays" options={{ title: "Public holidays" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function Root() {
  const t = useTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <StatusBar style={t.dark ? "light" : "dark"} />
          <Guard />
        </SessionProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
