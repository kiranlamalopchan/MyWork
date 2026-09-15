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
  it("says so when there is no connection", async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error("Network request failed"); }) as any;
    await expect(api("me/")).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/connection/) });
  });
});
