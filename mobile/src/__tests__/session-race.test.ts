import { api } from "@/api/client";
import { getToken, setToken } from "@/auth/token";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

test("an old request's 401 keeps a newly signed-in session", async () => {
  await setToken("old-session");
  let answer: (response: Response) => void = () => {};
  const started = new Promise<void>((resolveStarted) => {
    globalThis.fetch = jest.fn(() => new Promise<Response>((resolve) => {
      answer = resolve;
      resolveStarted();
    })) as typeof fetch;
  });
  const oldRequest = api("me/").catch((error) => error);
  await started;
  await setToken("new-session");
  answer({
    status: 401, ok: false,
    text: async () => JSON.stringify({ detail: "Invalid token." }),
    headers: { get: () => "application/json" },
  } as unknown as Response);
  expect(await oldRequest).toMatchObject({ status: 401 });
  expect(await getToken()).toBe("new-session");
});
