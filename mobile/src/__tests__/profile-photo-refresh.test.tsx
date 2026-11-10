import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { SessionProvider, useSession } from "@/auth/session";
import type { Me } from "@/api/types";

const mockMe = { username: "alice", name: "Alice", initial: "A", hue: 120, photo: null, is_live: false, is_me: true, is_admin: false } as Me;
const mockGetMe = jest.fn(async () => mockMe);
jest.mock("@/api", () => ({ ApiError: class extends Error {}, auth: {}, me: { get: () => mockGetMe() } }));
jest.mock("@/api/server", () => ({ loadServer: async () => {} }));
jest.mock("@/auth/lastMe", () => ({ loadLastMe: async () => null, saveLastMe: jest.fn() }));
jest.mock("@/push/register", () => ({ registerForPush: async () => {}, forgetPushToken: async () => null }));
jest.mock("@/auth/token", () => ({ getToken: async () => "session", onTokenChange: () => () => {}, setToken: async () => {} }));
jest.mock("@/auth/biometric", () => ({ armBiometric: jest.fn(), biometricUser: async () => null, disarmBiometric: jest.fn() }));

test("uploading, replacing and removing a photo refreshes cached Home faces immediately", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  let photo: string | null = null;
  const home = () => ({ notices: [{ author: { ...mockMe, photo } }], stories: [{ ...mockMe, photo }] });
  client.setQueryData(["home"], home());
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><SessionProvider>{children}</SessionProvider></QueryClientProvider>;
  const hook = await renderHook(() => ({ session: useSession(), home: useQuery({ queryKey: ["home"], queryFn: async () => home() }) }), { wrapper });
  await waitFor(() => expect(hook.result.current.session.ready).toBe(true));
  expect(hook.result.current.home.data?.notices[0].author.photo).toBeNull();

  for (const next of ["https://example.test/media/first.jpg", "https://example.test/media/second.jpg", null]) {
    photo = next;
    await act(async () => { hook.result.current.session.setMe({ ...mockMe, photo: next }); });
    await waitFor(() => expect(hook.result.current.home.data?.notices[0].author.photo).toBe(next));
    expect(hook.result.current.home.data?.stories[0].photo).toBe(next);
    expect(hook.result.current.session.me?.photo).toBe(next);
  }
  await hook.unmount();
  client.clear();
});
