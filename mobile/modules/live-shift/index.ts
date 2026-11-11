import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

/** A button pressed on the running-shift notification: which one, for which shift. */
export type LiveShiftAction = { action: string; shiftId: number };

export type LiveShiftOptions = {
  title: string;
  text: string;
  mode: "work" | "break";
  /** Epoch ms the timer counts up from. */
  since?: number;
  shiftId: number;
  channelName: string;
  actions: { id: string; label: string }[];
};

type Native = {
  show(options: LiveShiftOptions): boolean;
  hide(): void;
  takePendingAction(): LiveShiftAction | null;
  addListener(event: "onAction", listener: () => void): { remove(): void };
};

/** Android only, and only in a build that has the module (not Expo Go). */
export const LiveShift: Native | null = Platform.OS === "android" ? requireOptionalNativeModule<Native>("LiveShift") : null;
