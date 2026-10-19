import React from "react";
import { Platform } from "react-native";
import { act, renderHook } from "@testing-library/react-native";

import { BarSpaceProvider, useBringUpScroll } from "@/ui/depth";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 50, bottom: 0, left: 0, right: 0 }) }));

const BAR = 50 + 48;
const node = (y: number) => ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, y, 300, 60) });
const scrolled = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y } } }) as any;

async function page(content = 3000, view = 800) {
  const scrollTo = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => <BarSpaceProvider space={BAR}>{children}</BarSpaceProvider>;
  const hook = await renderHook(() => useBringUpScroll(scrollTo), { wrapper });
  await act(async () => {
    hook.result.current.onContentSizeChange(390, content);
    hook.result.current.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: view } } } as any);
  });
  return { scrollTo, bring: hook.result.current };
}

const original = Platform.OS;
afterEach(() => { Object.defineProperty(Platform, "OS", { value: original }); });

test("an opened section near the foot comes up to just under the status bar, where the bar will have stepped aside", async () => {
  Object.defineProperty(Platform, "OS", { value: "ios" });
  const { scrollTo, bring } = await page();
  bring.onScroll(scrolled(100));
  bring.bringUp(node(640));
  // 100 scrolled + 640 down the screen − (50 status bar + 12).
  expect(scrollTo).toHaveBeenCalledWith(678);
});

test("near the top of the page, where the bar stays, it comes up to just under the bar", async () => {
  Object.defineProperty(Platform, "OS", { value: "ios" });
  const { scrollTo, bring } = await page();
  bring.bringUp(node(160));
  expect(scrollTo).toHaveBeenCalledWith(160 - (BAR + 12));
});

test("never past the end of the page, and not at all when it is already there", async () => {
  Object.defineProperty(Platform, "OS", { value: "ios" });
  const { scrollTo, bring } = await page(1000, 800);
  bring.bringUp(node(700));
  expect(scrollTo).toHaveBeenCalledWith(200);
  scrollTo.mockClear();
  bring.onScroll(scrolled(0));
  bring.bringUp(node(BAR + 12 + 3));
  expect(scrollTo).not.toHaveBeenCalled();
});
