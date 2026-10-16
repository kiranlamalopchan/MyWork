import { getToken, setToken, signOutEverywhere, onTokenChange } from '@/auth/token';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

beforeEach(async () => { await setToken(null); });

test('a rejected old token cannot clear the current token or announce sign-out', async () => {
  await setToken('new-token');
  const changed = jest.fn();
  const unsubscribe = onTokenChange(changed);
  await signOutEverywhere('old-token');
  expect(await getToken()).toBe('new-token');
  expect(changed).not.toHaveBeenCalled();
  unsubscribe();
});

test('a rejected current token is still cleared and announced', async () => {
  await setToken('current-token');
  const changed = jest.fn();
  const unsubscribe = onTokenChange(changed);
  await signOutEverywhere('current-token');
  expect(await getToken()).toBeNull();
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
});
