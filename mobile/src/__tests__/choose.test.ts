import { rowValue, sheetRows, type Option } from "@/ui/choose";

// The sheet itself is iOS's and only appears on a device; what it is handed
// and what an index coming back means are testable, and both silently pick
// the wrong thing when they are wrong.
const states: Option[] = [
  { value: "NSW", label: "New South Wales" },
  { value: "VIC", label: "Victoria" },
  { value: "WA", label: "Western Australia" },
];

describe("the rows an iOS action sheet is given", () => {
  it("ticks the one you are on, and only that one", () => {
    expect(sheetRows(states, "VIC")).toEqual([
      "New South Wales", "✓ Victoria", "Western Australia", "Cancel",
    ]);
  });
  it("ticks nothing when the value is not among them", () => {
    expect(sheetRows(states, "QLD")).toEqual([
      "New South Wales", "Victoria", "Western Australia", "Cancel",
    ]);
  });
  it("puts Cancel last, where cancelButtonIndex says it is", () => {
    const rows = sheetRows(states, "NSW");
    expect(rows).toHaveLength(states.length + 1);
    expect(rows[states.length]).toBe("Cancel");
  });
});

describe("the index the sheet reports back", () => {
  it("is the option at that position", () => {
    expect(rowValue(states, 0)).toBe("NSW");
    expect(rowValue(states, 2)).toBe("WA");
  });
  it("is nothing at all for Cancel, or for a dismissed sheet", () => {
    expect(rowValue(states, states.length)).toBeNull();
    expect(rowValue(states, -1)).toBeNull();
    expect(rowValue(states, 99)).toBeNull();
  });
});
