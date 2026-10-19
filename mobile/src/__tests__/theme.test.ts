import { hueFor, mix } from "@/ui/theme";

// The same sums as apps/accounts/avatars.py: sum(ord(c) * (i + 1)) % 360.
describe("a person's colour", () => {
  it("matches the server's hue for a username", () => {
    const python = (name: string) => [...name].reduce((s, c, i) => s + c.charCodeAt(0) * (i + 1), 0) % 360;
    for (const name of ["kiran", "sam", "Butcher11643", "a"]) expect(hueFor(name)).toBe(python(name));
  });
});

// The holiday card is painted with mix(brand, surface, .1) on both the phone
// and the site, so this has to be what color-mix() would have made of it.
describe("blending two colours", () => {
  it("weighs the first by the amount given", () => {
    expect(mix("#059669", "#ffffff", 0.1)).toBe("#e6f5f0");
    expect(mix("#34d399", "#161a24", 0.1)).toBe("#192d30");
  });
  it("is either end at 1 and 0", () => {
    expect(mix("#059669", "#ffffff", 1)).toBe("#059669");
    expect(mix("#059669", "#ffffff", 0)).toBe("#ffffff");
  });
  it("gives up rather than guessing at a colour it cannot read", () => {
    expect(mix("rgba(0,0,0,.5)", "#ffffff", 0.5)).toBe("#ffffff");
  });
});

// A colour refactor must keep real text and actions readable in both themes.
describe("shared palette accessibility", () => {
  const { light, dark } = require("@/ui/theme");
  function luminance(hex: string) {
    const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  function contrast(a: string, b: string) {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + .05) / (values[1] + .05);
  }
  it("keeps dark pages pure black", () => expect(dark.bg).toBe("#000000"));
  for (const [mode, t] of [["light", light], ["dark", dark]] as const) {
    it(`${mode} text and action labels meet normal-text contrast`, () => {
      for (const background of [t.bg, t.surface, t.surface2]) {
        for (const ink of [t.text, t.text2, t.muted, t.brand, t.danger, t.warn]) expect(contrast(ink, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t.brandInk, t.brand)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.dangerInk, t.danger)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.walletInk, t.walletFrom)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
