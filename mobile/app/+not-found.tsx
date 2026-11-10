/**
 * An address with no screen behind it, or one the guard has put out of reach
 * (the home address while signed out, a link opened after signing out).
 * Nobody should see a dead end: send them where the guard lets them be.
 */
import { Redirect } from "expo-router";
import { useSession } from "@/auth/session";
import { useOnboarding } from "@/onboarding/seen";

export default function NotFound() {
  const { ready, me } = useSession();
  const { checked, seen } = useOnboarding();
  if (!ready || !checked) return null;
  if (me) return <Redirect href="/(tabs)/(home)" />;
  return <Redirect href={seen ? "/(auth)/login" : "/(onboarding)"} />;
}
