import { Platform } from "react-native";
import { inExpoGo } from "@/push/register";
import type { ClockState, Planned } from "@/api/types";
import { describeError, logError } from "@/api/errors";
import { widgetProps } from "./props";

let previous = "";
let queue: Promise<void> = Promise.resolve();

/** Serial updates keep a late refresh from putting a signed-out person's shift back. */
export function syncWorkWidgets(clock: ClockState | null, shifts: Planned[] = [], lock = true): Promise<void> {
  if (inExpoGo || (Platform.OS !== "ios" && Platform.OS !== "android")) return Promise.resolve();
  const props = widgetProps(clock, shifts[0]);
  const key = JSON.stringify([props, !!clock?.shift, lock]);
  queue = queue.then(async () => {
    if (previous === key) return;
    try {
      const widget = (require("./WorkWidget") as typeof import("./WorkWidget")).default;
      widget.updateSnapshot(props);
      if (Platform.OS === "ios") {
        const activity = (require("./ShiftActivity") as typeof import("./ShiftActivity")).default;
        const instances = activity.getInstances();
        if (!clock?.shift || !lock) {
          for (const instance of instances) await instance.end("immediate");
        } else {
          const [first, ...duplicates] = instances;
          for (const instance of duplicates) await instance.end("immediate");
          if (first) await first.update(props);
          else activity.start(props, "mywork://clock");
        }
      }
      previous = key;
    } catch (error) { logError(describeError(error).report); }
  });
  return queue;
}
