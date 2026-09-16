import { targetFor } from "@/nav/paths";

describe("the site's paths map to screens", () => {
  it("lands a notification about a notice on that notice", () => {
    expect(targetFor("/notices/?notice=12")).toEqual({ screen: "/notices/12" });
    expect(targetFor("/notices/12/")).toEqual({ screen: "/notices/12" });
    expect(targetFor("/notices/")).toEqual({ screen: "/board" });
  });
  it("knows people, stories, the inbox, PLU and holidays", () => {
    expect(targetFor("/notices/people/sam/")).toEqual({ screen: "/people/sam" });
    expect(targetFor("/stories/sam/")).toEqual({ screen: "/stories/sam" });
    expect(targetFor("/notifications/")).toEqual({ screen: "/notifications" });
    expect(targetFor("/plu/item/7012/")).toEqual({ screen: "/plu/7012" });
    expect(targetFor("/holidays/")).toEqual({ screen: "/holidays" });
    expect(targetFor("/")).toEqual({ screen: "/(tabs)" });
  });
  it("knows the timesheet's pages", () => {
    expect(targetFor("/timesheet/")).toEqual({ screen: "/clock" });
    expect(targetFor("/timesheet/shifts/3/")).toEqual({ screen: "/shifts/3" });
    expect(targetFor("/timesheet/shifts/3/edit/")).toEqual({ screen: "/shifts/3/edit" });
    expect(targetFor("/timesheet/pay/")).toEqual({ screen: "/pay" });
    expect(targetFor("/timesheet/workplaces/")).toEqual({ screen: "/workplaces" });
  });
  it("keeps every PLU and timesheet path in the app, which draws them all", () => {
    expect(targetFor("/plu/photo-search/")).toEqual({ screen: "/plu" });
    expect(targetFor("/plu/import/")).toEqual({ screen: "/plu" });
    expect(targetFor("/timesheet/statement/")).toEqual({ screen: "/clock" });
    expect(targetFor("/timesheet/preferences/")).toEqual({ screen: "/clock" });
  });
  it("sends what the app doesn't draw to the site", () => {
    expect(targetFor("/admin/")).toEqual({ web: "/admin/" });
  });
});
