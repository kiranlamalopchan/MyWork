import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Animated, Text } from "react-native";
import { WorkPage } from "@/ui/WorkPage";
import { ChoiceRail } from "@/ui/ChoiceRail";

let mockReduced = false;
jest.mock("@/ui/useReducedMotion", () => ({ useReducedMotion: () => mockReduced }));
jest.mock("@/ui/index", () => ({ Page: ({ children }: any) => children }));
jest.mock("@/ui/haptics", () => ({ tick: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

beforeEach(() => { jest.restoreAllMocks(); mockReduced = false; });

test("Work content is immediately visible without a transition", async () => {
  const timing = jest.spyOn(Animated, "timing");
  const screen = await render(<WorkPage><Text>Work content</Text></WorkPage>);
  expect(screen.getByText("Work content")).toBeTruthy();
  expect(timing).not.toHaveBeenCalled();
});

test("the swipeable region row keeps its single-choice selection", async () => {
  const options = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map(value => ({ value, label: value }));
  function Regions() { const [value, setValue] = React.useState("TAS"); return <ChoiceRail label="Regions" value={value} onChange={setValue} options={options} />; }
  const screen = await render(<Regions />);
  expect(screen.getByRole("radio", { name: "TAS" })).toHaveProp("accessibilityState", { checked: true });
  await fireEvent.press(screen.getByRole("radio", { name: "WA" }));
  expect(screen.getByRole("radio", { name: "WA" })).toHaveProp("accessibilityState", { checked: true });
  expect(screen.getByRole("radio", { name: "TAS" })).toHaveProp("accessibilityState", { checked: false });
});
