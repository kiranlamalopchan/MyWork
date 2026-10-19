import { Stack } from "expo-router";
import { pushOptions } from "@/ui/transitions";

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, ...pushOptions }} />;
}
