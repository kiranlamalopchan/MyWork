/** After a password sign-in: the lock offered once, then notifications once, in the phone's dialogs. */
const mockStore: Record<string, string> = {};
const mockPhone = { hardware: true, enrolled: true, types: [2], recognised: true, push: "undetermined", grants: true };
const mockAsked: string[] = [];
let mockAnswer = true;
const mockServer = { registered: [] as string[] };

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock("expo-local-authentication", () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => mockPhone.hardware),
  isEnrolledAsync: jest.fn(async () => mockPhone.enrolled),
  supportedAuthenticationTypesAsync: jest.fn(async () => mockPhone.types),
  authenticateAsync: jest.fn(async () => ({ success: mockPhone.recognised })),
}));
jest.mock("expo-device", () => ({ isDevice: true, deviceName: "Test phone", modelName: "Test" }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { appOwnership: null, executionEnvironment: "standalone", expoConfig: { extra: { eas: { projectId: "p" } } } } }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPhone.push, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => { mockPhone.push = mockPhone.grants ? "granted" : "denied"; return { status: mockPhone.push, canAskAgain: true }; }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc]" })),
}));
jest.mock("@/api", () => ({ me: { registerDevice: jest.fn(async (t: string) => { mockServer.registered.push(t); }), unregisterDevice: jest.fn(async () => {}) } }));
jest.mock("@/ui/confirm", () => ({ ask: jest.fn(async (title: string) => { mockAsked.push(title); return mockAnswer; }), notify: jest.fn(), confirm: jest.fn() }));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn(), warn: jest.fn(), fail: jest.fn(), tap: jest.fn() }));

import * as LA from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { biometricUser } from "@/auth/biometric";
import { setToken } from "@/auth/token";
import { welcome } from "@/auth/welcome";

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  Object.assign(mockPhone, { hardware: true, enrolled: true, types: [2], recognised: true, push: "undetermined", grants: true });
  mockAsked.length = 0; mockServer.registered.length = 0; mockAnswer = true;
  jest.clearAllMocks();
  await setToken("tok-1");
});

test("yes to both: the lock is met before it is armed, then the phone is asked and registered", async () => {
  await welcome("kiran");
  expect(mockAsked).toEqual(["Sign in with Face ID?", "Turn on notifications?"]);
  expect(LA.authenticateAsync).toHaveBeenCalledTimes(1);
  expect(await biometricUser()).toBe("kiran");
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(mockServer.registered).toEqual(["ExponentPushToken[abc]"]);
});

test("not recognised by the lock: nothing is armed, and the offer is not repeated", async () => {
  mockPhone.recognised = false;
  await welcome("kiran");
  expect(await biometricUser()).toBeNull();
  await welcome("kiran");
  expect(mockAsked.filter((t) => t.startsWith("Sign in with"))).toHaveLength(1);
});

test("not now: neither is asked again on the next sign-in, and a different person is offered the lock", async () => {
  mockAnswer = false;
  await welcome("kiran");
  expect(mockAsked).toHaveLength(2);
  expect(LA.authenticateAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await welcome("kiran");
  expect(mockAsked).toHaveLength(2);
  await welcome("sam");
  expect(mockAsked).toEqual(["Sign in with Face ID?", "Turn on notifications?", "Sign in with Face ID?"]);
});

test("a phone already asked about notifications, or with no lock, is left alone", async () => {
  mockPhone.push = "granted";
  mockPhone.enrolled = false;
  await welcome("kiran");
  expect(mockAsked).toEqual([]);
  mockPhone.push = "denied";
  await welcome("kiran");
  expect(mockAsked).toEqual([]);
});

test("someone the lock already opens for is not asked again", async () => {
  await welcome("kiran");
  mockAsked.length = 0;
  await welcome("kiran");
  expect(mockAsked).toEqual([]);
});
