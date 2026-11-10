import Constants from "expo-constants";
import { openAuthSessionAsync, WebBrowserResultType } from "expo-web-browser";
import { auth } from "@/api";
import { authenticateWithProvider, SOCIAL_RETURN_URL } from "@/auth/social";

jest.mock("expo-constants", () => ({ __esModule: true, default: { appOwnership: "standalone", executionEnvironment: "standalone" } }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn(), WebBrowserResultType: { CANCEL: "cancel" } }));
jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(Array.from({ length: 32 }, (_, i) => i))),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" }, CryptoEncoding: { BASE64: "base64" },
  digestStringAsync: jest.fn(async (_: string, value: string) => require("crypto").createHash("sha256").update(value).digest("base64")),
}));
jest.mock("@/api", () => ({ ...jest.requireActual("@/api"), auth: { socialStart: jest.fn(), socialExchange: jest.fn() } }));

const code = "a".repeat(43);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(auth.socialStart).mockResolvedValue({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=state", return_url: SOCIAL_RETURN_URL });
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: "success", url: `${SOCIAL_RETURN_URL}?code=${code}` });
  jest.mocked(auth.socialExchange).mockResolvedValue({ reauth_token: "receipt" });
});

test("the app exchanges a one-use callback with its locally held proof", async () => {
  expect(await authenticateWithProvider("google")).toEqual({ reauth_token: "receipt" });
  const verifier = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
  const challenge = require("crypto").createHash("sha256").update(verifier).digest("base64url");
  expect(auth.socialStart).toHaveBeenCalledWith("google", challenge, "login");
  expect(openAuthSessionAsync).toHaveBeenCalledWith(expect.stringContaining("https://accounts.google.com"), SOCIAL_RETURN_URL);
  expect(auth.socialExchange).toHaveBeenCalledWith(code, verifier);
});
test("Apple reauthentication uses the same proof and the Apple browser", async () => {
  jest.mocked(auth.socialStart).mockResolvedValue({ url: "https://appleid.apple.com/auth/authorize", return_url: SOCIAL_RETURN_URL });
  await authenticateWithProvider("apple", "reauth");
  expect(auth.socialStart).toHaveBeenCalledWith("apple", expect.any(String), "reauth");
});
test("cancelling browser sign-in never exchanges a code", async () => {
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: WebBrowserResultType.CANCEL });
  expect(await authenticateWithProvider("google")).toBeNull();
  expect(auth.socialExchange).not.toHaveBeenCalled();
});
test.each(["mywork://attacker?code=" + code, SOCIAL_RETURN_URL + "?code=invalid"])("unexpected callback %s cannot authenticate", async url => {
  jest.mocked(openAuthSessionAsync).mockResolvedValue({ type: "success", url });
  await expect(authenticateWithProvider("google")).rejects.toMatchObject({ status: 400 });
  expect(auth.socialExchange).not.toHaveBeenCalled();
});
test("the browser can only open the chosen provider and fixed app callback", async () => {
  jest.mocked(auth.socialStart).mockResolvedValue({ url: "https://attacker.example/login", return_url: SOCIAL_RETURN_URL });
  await expect(authenticateWithProvider("google")).rejects.toMatchObject({ status: 400 });
  expect(openAuthSessionAsync).not.toHaveBeenCalled();
});
test("Expo Go explains that the installed app is needed", async () => {
  Object.defineProperty(Constants, "appOwnership", { configurable: true, value: "expo" });
  try {
    await expect(authenticateWithProvider("google")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("installed app") });
    expect(auth.socialStart).not.toHaveBeenCalled();
  } finally { Object.defineProperty(Constants, "appOwnership", { configurable: true, value: "standalone" }); }
});
