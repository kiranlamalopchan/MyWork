import { targetFor } from "@/nav/paths";

describe("the site's paths map to screens", () => {
  it("lands a notification about a notice on that notice", () => {
    expect(targetFor("/notices/?notice=12")).toEqual({ screen: "/notices/12" });
    expect(targetFor("/notices/12/")).toEqual({ screen: "/notices/12" });
    expect(targetFor("/notices/")).toEqual({ screen: "/(tabs)/board" });
  });
  it("knows people, stories, the inbox, PLU and holidays", () => {
    expect(targetFor("/notices/people/sam/")).toEqual({ screen: "/people/sam" });
    expect(targetFor("/stories/sam/")).toEqual({ screen: "/stories/sam" });
    expect(targetFor("/notifications/")).toEqual({ screen: "/(tabs)/notifications" });
    expect(targetFor("/plu/item/7012/")).toEqual({ screen: "/plu/7012" });
    expect(targetFor("/holidays/")).toEqual({ screen: "/holidays" });
    expect(targetFor("/")).toEqual({ screen: "/(tabs)" });
  });
  it("sends what the app doesn't do yet to the site", () => {
    expect(targetFor("/timesheet/shifts/3/")).toEqual({ web: "/timesheet/shifts/3/" });
  });
});
