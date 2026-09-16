import { api, ApiError } from "@/api/client";

jest.mock("@/auth/token", () => ({ getToken: jest.fn(async () => "tok"), signOutEverywhere: jest.fn(async () => {}) }));

const reply = (status: number, body: unknown) =>
  jest.fn(async () => ({ status, ok: status < 400, text: async () => (body === undefined ? "" : JSON.stringify(body)) }));

describe("the API client", () => {
  it("sends the token and the time zone, and parses JSON", async () => {
    const fetchMock = reply(200, { hello: "there" });
    globalThis.fetch = fetchMock as any;
    await expect(api("home/")).resolves.toEqual({ hello: "there" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/home\/$/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Token tok");
    expect((init.headers as Record<string, string>)["X-Timezone"]).toBeTruthy();
  });
  it("turns a refusal into the server's sentence and field errors", async () => {
    globalThis.fetch = reply(400, { detail: "Write something.", fields: { body: ["Write something."] } }) as any;
    await expect(api("notices/", { method: "POST", body: { body: "" } })).rejects.toMatchObject({ status: 400, message: "Write something.", fields: { body: ["Write something."] } });
  });
  it("signs out on a 401", async () => {
    const { signOutEverywhere } = require("@/auth/token");
    globalThis.fetch = reply(401, { detail: "Invalid token." }) as any;
    await expect(api("me/")).rejects.toBeInstanceOf(ApiError);
    expect(signOutEverywhere).toHaveBeenCalled();
  });
  it("says so when there is no connection, naming the server", async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error("Network request failed"); }) as any;
    await expect(api("me/")).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Couldn't reach http:\/\/.*connection.*server address/) });
  });
  it("tells a site without the API apart from a missing thing", async () => {
    // Django's own HTML 404 page: the site is there, the API is not.
    globalThis.fetch = jest.fn(async () => ({ status: 404, ok: false, text: async () => "<!DOCTYPE html><title>Page not found</title>" })) as any;
    await expect(api("home/")).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/doesn't have the MyWork app API/) });
    // The API's own JSON 404 stays what the server said.
    globalThis.fetch = reply(404, { detail: "Not found." }) as any;
    await expect(api("notices/999/")).rejects.toMatchObject({ status: 404, message: "Not found." });
    // A page that answers 200 with HTML (the site's own pointer page, a captive portal) is no API either.
    globalThis.fetch = jest.fn(async () => ({ status: 200, ok: true, headers: { get: () => "text/html; charset=utf-8" }, text: async () => "<!doctype html><title>PLU is in the app</title>" })) as any;
    await expect(api("auth/login/", { method: "POST", body: {}, anonymous: true })).rejects.toMatchObject({ message: expect.stringMatching(/doesn't have the MyWork app API/) });
  });
});

describe("the server address", () => {
  const { clean, defaultServer } = require("@/api/server");
  it("fills in http:// and drops trailing slashes", () => {
    expect(clean("192.168.0.11:8000/")).toBe("http://192.168.0.11:8000");
    expect(clean("https://example.com//")).toBe("https://example.com");
  });
  it("never defaults to localhost on a phone running from Metro", () => {
    // In this test environment EXPO_PUBLIC_API_URL is unset and there is no Metro host, so the last resort applies.
    expect(defaultServer()).toMatch(/^https?:\/\//);
  });
});
