import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { PhotoSearch } from "@/ui/PhotoSearch";
import { plu } from "@/api";
import { openPdf } from "@/ui/pdf";
import { notify } from "@/ui/confirm";

jest.mock("@/storage/media", () => ({ keepDraftMedia: async (asset: unknown) => asset, removeDraftMedia: jest.fn() }));
jest.mock("@/storage/private", () => ({
  usePrivateState: (_key: string, initial: unknown) => {
    const React = require("react");
    const [value, set] = React.useState(initial);
    return [value, set, true];
  },
}));
jest.mock("@/ui/PhotoEditor", () => {
  const { Pressable, Text } = require("react-native");
  return { PhotoEditor: ({ asset, onDone }: any) => <Pressable testID="photo-read-selected" onPress={() => onDone(asset)}><Text>Read selected area</Text></Pressable> };
});
let mockSetHandler: () => Promise<void>;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/api", () => ({
  plu: { photo: jest.fn(), one: jest.fn(), photoPdfUrl: () => "/photo/pdf/" },
}));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchCameraAsync: async () => ({
    canceled: false,
    assets: [{ uri: "file://test.jpg", fileName: "test.jpg", mimeType: "image/jpeg" }],
  }),
}));
jest.mock("@/ui/confirm", () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock("@/ui/haptics", () => ({ success: jest.fn(), tick: jest.fn() }));
jest.mock("@/ui/pdf", () => ({ openPdf: jest.fn() }));
jest.mock("@/ui/Skeleton", () => ({ SkeletonRows: () => null }));
jest.mock("@/ui/theme", () => ({
  alpha: () => "transparent", radius: { sm: 4 }, sp: { 2: 8, 3: 12, 4: 16 },
  useTheme: () => ({
    text: "black", muted: "gray", blue: "blue", bg: "white", line: "gray",
    surface2: "white", brand: "green", warn: "orange", danger: "red",
  }),
}));
jest.mock("@/ui/index", () => {
  const { View, Pressable, Text, TextInput } = require("react-native");
  return {
    Button: ({ title, onPress, testID, disabled }: any) => {
      if (title === "Set") mockSetHandler = onPress;
      return <Pressable testID={testID} onPress={onPress} disabled={disabled}><Text>{title}</Text></Pressable>;
    },
    Card: ({ children }: any) => <View>{children}</View>,
    Chip: ({ children, onPress }: any) => <Pressable onPress={onPress}><Text>{children}</Text></Pressable>,
    Input: (props: any) => <TextInput {...props} />,
    Empty: ({ action }: any) => <View>{action}</View>,
  };
});

const read = (plu_no: number, description: string) => ({
  skipped: 0,
  rows: [{ line: description, item: { plu_no, description }, score: .8, sureness: "sure", by_code: false, alternatives: [] }],
});

beforeEach(() => jest.clearAllMocks());

it.each(["success", "failure"])("ignores a late %s from a correction on the previous slip", async (outcome) => {
  (plu.photo as jest.Mock)
    .mockResolvedValueOnce(read(100, "First slip product"))
    .mockResolvedValueOnce(read(200, "Second slip product"));
  let finish: (value: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  (plu.one as jest.Mock).mockImplementation(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
  const screen = await render(<PhotoSearch catalogueId={1} />);
  await fireEvent.press(screen.getByTestId("photo-camera"));
  await fireEvent.press(screen.getByTestId("photo-read-selected"));
  await waitFor(() => expect(screen.getByText("First slip product")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("photo-row-0"));
  await fireEvent.changeText(screen.getByPlaceholderText("Another PLU number"), "300");
  // Start the lookup without waiting for its network response.
  await act(async () => { void mockSetHandler(); });
  await waitFor(() => expect(plu.one).toHaveBeenCalledWith(300, 1));
  await fireEvent.press(screen.getByText("New photo"));
  await fireEvent.press(screen.getByTestId("photo-read-selected"));
  await waitFor(() => expect(screen.getByText("Second slip product")).toBeTruthy());
  await act(async () => {
    if (outcome === "success") finish({ plu_no: 300, description: "Late correction for FIRST slip" });
    else reject(new Error("Old lookup failed"));
  });
  expect(screen.getByText("Second slip product")).toBeTruthy();
  expect(screen.queryByText("Late correction for FIRST slip")).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("photo-pdf"));
  expect(openPdf).toHaveBeenCalledWith("/photo/pdf/", "picking-list.pdf", {
    rows: [{ plu_no: 200, line: "Second slip product" }],
  });
  await screen.unmount();
});

test("a correction for the current slip still updates the product and PDF", async () => {
  (plu.photo as jest.Mock).mockResolvedValueOnce(read(100, "First slip product"));
  (plu.one as jest.Mock).mockResolvedValueOnce({ plu_no: 300, description: "Correct product" });
  const screen = await render(<PhotoSearch catalogueId={1} />);
  await fireEvent.press(screen.getByTestId("photo-camera"));
  await fireEvent.press(screen.getByTestId("photo-read-selected"));
  await fireEvent.press(screen.getByTestId("photo-row-0"));
  await fireEvent.changeText(screen.getByPlaceholderText("Another PLU number"), "300");
  await fireEvent.press(screen.getByText("Set"));
  expect(screen.getByText("Correct product")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("photo-pdf"));
  expect(openPdf).toHaveBeenCalledWith("/photo/pdf/", "picking-list.pdf", {
    rows: [{ plu_no: 300, line: "First slip product" }],
  });
  await screen.unmount();
});
