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
