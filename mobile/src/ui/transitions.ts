/**
 * How one page gives way to the next — the same in every stack.
 *
 * iOS's own push slides the new page in with a dark shadow down its edge and
 * dims the page it covers, which reads as a grey band sweeping the side of
 * the app on every tap. "simple_push" is the same slide with neither: both
 * pages move together, the edge stays clean, and swiping back still works.
 * Android keeps its own system transition, which has no such band.
 */
import { Platform } from "react-native";

export const pushOptions = Platform.OS === "ios"
  ? { animation: "simple_push" as const, fullScreenSwipeShadowEnabled: false }
  : {};

/**
 * A screen that rises from the bottom (writing a notice, a story, the
 * reactions list). iOS's sheet style shrinks the page behind it and leaves a
 * black border round the app; full screen covers it instead. Each of these
 * screens has its own back button, so nothing is lost with the swipe-down.
 */
export const riseOptions = { presentation: "fullScreenModal" as const };
