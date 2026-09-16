/**
 * The way in. Shown once, on a phone that has not seen it, between the
 * splash lifting and the sign-in screen — see src/onboarding/seen.tsx for
 * where that "once" is kept, and app/_layout.tsx for the guard.
 */
import React from "react";

import { useOnboarding } from "@/onboarding/seen";
import { Onboarding } from "@/ui/Onboarding";

export default function Welcome() {
  const { finish } = useOnboarding();
  return <Onboarding onDone={finish} />;
}
