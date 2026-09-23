import { versionLine } from "@/ui/Version";

/**
 * The line under the profile. Three numbers are available and at most two
 * are worth printing: saying the same version twice teaches nobody
 * anything, and a mismatch is the whole reason the server's is there.
 */
describe("the version line", () => {
  it("reads as one app when the server agrees", () => {
    expect(versionLine("1.1.0", "8", "1.1.0")).toBe("KaamKoRecord 1.1.0 (8)");
  });

  it("says both when the server has not caught up", () => {
    expect(versionLine("1.2.0", "9", "1.1.0")).toBe("KaamKoRecord 1.2.0 (9) · server 1.1.0");
  });

  it("says both when the server is ahead of the app", () => {
    expect(versionLine("1.1.0", "8", "1.2.0")).toBe("KaamKoRecord 1.1.0 (8) · server 1.2.0");
  });

  it("manages without a build number", () => {
    expect(versionLine("1.1.0", "", undefined)).toBe("KaamKoRecord 1.1.0");
  });

  it("manages without the server, which is every screen before it answers", () => {
    expect(versionLine("1.1.0", "8", undefined)).toBe("KaamKoRecord 1.1.0 (8)");
  });

  it("still says something when only the server is known", () => {
    expect(versionLine("", "", "1.1.0")).toBe("KaamKoRecord · server 1.1.0");
  });

  it("says nothing at all rather than something empty", () => {
    expect(versionLine("", "", undefined)).toBe("");
  });
});
