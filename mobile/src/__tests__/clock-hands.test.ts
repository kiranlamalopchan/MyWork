import { clockHands } from "../ui/clockHands";

describe("analog wall clock", () => {
  it("aligns hour and minute hands between markers", () => {
    expect(clockHands(new Date(2026, 9, 9, 3, 15, 30).getTime())).toEqual({ hour: 97.75, minute: 93, second: 180 });
  });
  it("shows midnight and noon at twelve, and wraps at the next hour", () => {
    for (const hour of [0, 12]) expect(clockHands(new Date(2026, 9, 9, hour).getTime())).toEqual({ hour: 0, minute: 0, second: 0 });
    expect(clockHands(new Date(2026, 9, 9, 23, 59, 59).getTime()).hour).toBeCloseTo(359.9916667);
    expect(clockHands(new Date(2026, 9, 10, 0).getTime())).toEqual({ hour: 0, minute: 0, second: 0 });
  });
});
