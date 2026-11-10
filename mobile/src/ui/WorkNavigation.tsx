import { useRouter } from "expo-router";
import { Segments, useLayout } from "@/ui";
import { useT } from "@/i18n";

const routes = { clock: "/work", timesheet: "/work/timesheet", pay: "/work/pay", settings: "/work/tools" } as const;
export function WorkNavigation({ active, wide }: { active: keyof typeof routes; wide?: boolean }) {
  const router = useRouter(), tr = useT();
  // On a two-column desktop page (`wide`) it keeps a column's width, not the whole window's.
  const { desk } = useLayout();
  return <Segments animated={false} label="Work sections" style={wide && desk ? { maxWidth: 560, width: "100%" } : undefined} value={active} onChange={(value) => router.navigate(routes[value as keyof typeof routes])} options={[
    { value: "clock", label: tr("Clock") }, { value: "timesheet", label: tr("Timesheets") },
    { value: "pay", label: tr("Pay") }, { value: "settings", label: tr("Settings") },
  ]} />;
}
