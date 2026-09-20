/** The push switch: what the phone says, what is kept, what the server is told. */
const mockStore: Record<string, string> = {};
const mockPhone = { status: "undetermined", canAskAgain: true, grants: true };
const mockServer = { registered: [] as string[], removed: [] as string[] };

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock("expo-device", () => ({ isDevice: true, deviceName: "Test phone", modelName: "Test" }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { appOwnership: null, executionEnvironment: "standalone", expoConfig: { extra: { eas: { projectId: "p" } } } } }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPhone.status, canAskAgain: mockPhone.canAskAgain })),
  requestPermissionsAsync: jest.fn(async () => {
    mockPhone.status = mockPhone.grants ? "granted" : "denied";
    if (!mockPhone.grants) mockPhone.canAskAgain = false;
    return { status: mockPhone.status, canAskAgain: mockPhone.canAskAgain };
  }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc]" })),
}));
jest.mock("@/api", () => ({
  me: {
    registerDevice: jest.fn(async (token: string) => { mockServer.registered.push(token); }),
    unregisterDevice: jest.fn(async (token: string) => { mockServer.removed.push(token); }),
  },
}));

import { disablePush, enablePush, forgetPushToken, pushState, registerForPush } from "@/push/register";

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  Object.assign(mockPhone, { status: "undetermined", canAskAgain: true, grants: true });
  mockServer.registered.length = 0;
  mockServer.removed.length = 0;
});

test("never asked: off; the switch asks, registers, and is then on", async () => {
  expect(await pushState()).toBe("off");
  expect(await enablePush()).toBe("on");
  expect(mockServer.registered).toEqual(["ExponentPushToken[abc]"]);
  expect(await pushState()).toBe("on");
});

test("turned off: the server forgets the phone, and a sign-in does not turn it back on", async () => {
  await enablePush();
  await disablePush();
  expect(mockServer.removed).toEqual(["ExponentPushToken[abc]"]);
  expect(await pushState()).toBe("off");
  expect(await registerForPush()).toBeNull();
  expect(await registerForPush({ quiet: true })).toBeNull();
  expect(mockServer.registered).toHaveLength(1);
  // Turned back on: registered again without the phone being asked twice.
  expect(await enablePush()).toBe("on");
  expect(mockServer.registered).toHaveLength(2);
});

test("a phone that said no for good is blocked, and stays so until Settings", async () => {
  mockPhone.grants = false;
  expect(await enablePush()).toBe("blocked");
  expect(mockServer.registered).toHaveLength(0);
  expect(await pushState()).toBe("blocked");
});

test("a quiet cold start registers only a phone that already said yes", async () => {
  expect(await registerForPush({ quiet: true })).toBeNull();
  expect(mockServer.registered).toHaveLength(0);
  mockPhone.status = "granted";
  expect(await registerForPush({ quiet: true })).toBe("ExponentPushToken[abc]");
});

test("sign-out hands back the token it was given, once", async () => {
  await enablePush();
  expect(await forgetPushToken()).toBe("ExponentPushToken[abc]");
  expect(await forgetPushToken()).toBeNull();
  expect(await pushState()).toBe("off");
});
