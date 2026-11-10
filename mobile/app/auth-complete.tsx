/** The browser has returned; resume the screen that opened sign-in. */
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useSession } from "@/auth/session";

export default function AuthComplete() {
  const router = useRouter();
  const { me } = useSession();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace(me ? "/profile/privacy" : "/(auth)/login");
  }, [router, me]);
  return null;
}
