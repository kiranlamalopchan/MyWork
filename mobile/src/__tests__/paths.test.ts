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
  it("opens profile destinations directly, including old section links", () => {
    for (const section of ["friends", "statement", "activity"]) {
      expect(targetFor(`/profile/${section}/`)).toEqual({ screen: `/profile/${section}` });
      expect(targetFor(`/profile/#${section}`)).toEqual({ screen: `/profile/${section}` });
    }
  });
  it("knows the timesheet's pages", () => {
    expect(targetFor("/timesheet/")).toEqual({ screen: "/clock" });
    expect(targetFor("/timesheet/shifts/3/")).toEqual({ screen: "/shifts/3" });
    expect(targetFor("/timesheet/shifts/3/edit/")).toEqual({ screen: "/shifts/3/edit" });
    expect(targetFor("/timesheet/pay/")).toEqual({ screen: "/pay" });
    expect(targetFor("/timesheet/workplaces/")).toEqual({ screen: "/workplaces" });
    // The calendar is a face of the timesheet now, not a screen of its own.
    expect(targetFor("/timesheet/calendar/")).toEqual({ screen: "/timesheet?view=calendar" });
  });
  it("keeps every PLU and timesheet path in the app, which draws them all", () => {
    expect(targetFor("/plu/photo-search/")).toEqual({ screen: "/plu" });
    expect(targetFor("/plu/import/")).toEqual({ screen: "/items/import" });
    expect(targetFor("/timesheet/statement/")).toEqual({ screen: "/profile/statement" });
    expect(targetFor("/timesheet/preferences/")).toEqual({ screen: "/clock" });
  });
  it("recognises the go-link actually sent in push notifications", () => {
    expect(targetFor("/notifications/123/go/")).toEqual({ notification: 123 });
    expect(targetFor("https://example.com/notifications/123/go/")).toEqual({ notification: 123 });
  });
  it("keeps unsupported or malformed notification links in the app", () => {
    expect(targetFor("/admin/")).toEqual({ screen: "/notifications" });
    expect(targetFor("http://[")).toEqual({ screen: "/notifications" });
  });
});
