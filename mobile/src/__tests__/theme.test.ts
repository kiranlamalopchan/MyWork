import { hueFor } from "@/ui/theme";

// The same sums as apps/accounts/avatars.py: sum(ord(c) * (i + 1)) % 360.
describe("a person's colour", () => {
  it("matches the server's hue for a username", () => {
    const python = (name: string) => [...name].reduce((s, c, i) => s + c.charCodeAt(0) * (i + 1), 0) % 360;
    for (const name of ["kiran", "sam", "Butcher11643", "a"]) expect(hueFor(name)).toBe(python(name));
  });
});
