/** Provider credentials never enter the app; only a proof-bound, one-use code does. */
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { openAuthSessionAsync } from "expo-web-browser";
import { ApiError, auth } from "@/api";

export type SocialProvider = "google" | "apple";
export type SocialPurpose = "login" | "link" | "reauth";
export const SOCIAL_RETURN_URL = "mywork://auth-complete";

export async function authenticateWithProvider(provider: SocialProvider, purpose: SocialPurpose = "login") {
  if (Constants.appOwnership === "expo" || Constants.executionEnvironment === "storeClient") {
    throw new ApiError(400, "Please open the installed app to use Google or Apple sign-in.");
  }
  const bytes = await Crypto.getRandomBytesAsync(32);
  const verifier = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  const challenge = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const start = await auth.socialStart(provider, challenge, purpose);
  const expectedOrigin = provider === "google" ? "https://accounts.google.com" : "https://appleid.apple.com";
  if (new URL(start.url).origin !== expectedOrigin || start.return_url !== SOCIAL_RETURN_URL) {
    throw new ApiError(400, "We couldn't complete sign-in. Please try again.");
  }
  const result = await openAuthSessionAsync(start.url, SOCIAL_RETURN_URL);
  if (result.type !== "success") return null;
  const callback = new URL(result.url);
  if (`${callback.protocol}//${callback.host}${callback.pathname}` !== SOCIAL_RETURN_URL) {
    throw new ApiError(400, "We couldn't complete sign-in. Please try again.");
  }
  const code = callback.searchParams.get("code") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new ApiError(400, "Please restart sign-in and try again.");
  return auth.socialExchange(code, verifier);
}
