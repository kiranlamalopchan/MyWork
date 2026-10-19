import { useRouter } from "expo-router";
import { Segments, useLayout } from "@/ui";

const routes = { clock: "/work", timesheet: "/work/timesheet", pay: "/work/pay", settings: "/work/tools" } as const;
export function WorkNavigation({ active, wide }: { active: keyof typeof routes; wide?: boolean }) {
  const router = useRouter();
  // On a two-column desktop page (`wide`) it keeps a column's width, not the whole window's.
  const { desk } = useLayout();
  return <Segments animated={false} label="Work sections" style={wide && desk ? { maxWidth: 560, width: "100%" } : undefined} value={active} onChange={(value) => router.navigate(routes[value as keyof typeof routes])} options={[
    { value: "clock", label: "Clock" }, { value: "timesheet", label: "Timesheets" },
    { value: "pay", label: "Pay" }, { value: "settings", label: "Settings" },
  ]} />;
}
