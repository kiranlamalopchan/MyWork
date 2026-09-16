/** Signing in with the phone's lock: what is kept, what the prompt gives back. */
const mockStore: Record<string, string> = {};
const mockPhone = { hardware: true, enrolled: true, types: [2], recognised: true };

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

import { armBiometric, biometricKind, biometricName, biometricUser, disarmBiometric, unlockWithBiometric } from "@/auth/biometric";

beforeEach(() => { for (const k of Object.keys(mockStore)) delete mockStore[k]; Object.assign(mockPhone, { hardware: true, enrolled: true, types: [2], recognised: true }); });

test("the kind follows what the phone has and has enrolled", async () => {
  expect(await biometricKind()).toBe("face");
  expect(biometricName("face")).toBe("Face ID");
  mockPhone.types = [1];
  expect(await biometricKind()).toBe("fingerprint");
  mockPhone.enrolled = false;
  expect(await biometricKind()).toBeNull();
  mockPhone.enrolled = true; mockPhone.hardware = false;
  expect(await biometricKind()).toBeNull();
});

test("nothing kept: the lock has nothing to open", async () => {
  expect(await biometricUser()).toBeNull();
  await expect(unlockWithBiometric()).rejects.toThrow(/password first/);
});

test("armed: the prompt gives the token back, or null when not recognised; disarmed: gone", async () => {
  await armBiometric("kiran", "tok-123");
  expect(await biometricUser()).toBe("kiran");
  expect(await unlockWithBiometric()).toBe("tok-123");
  mockPhone.recognised = false;
  expect(await unlockWithBiometric()).toBeNull();
  await disarmBiometric();
  expect(await biometricUser()).toBeNull();
  await expect(unlockWithBiometric()).rejects.toThrow();
});
