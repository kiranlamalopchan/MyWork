import { useRouter } from "expo-router";
import { Segments } from "@/ui";

const routes = { clock: "/work", timesheet: "/work/timesheet", pay: "/work/pay", settings: "/work/tools" } as const;
export function WorkNavigation({ active }: { active: keyof typeof routes }) {
  const router = useRouter();
  return <Segments value={active} onChange={(value) => router.navigate(routes[value as keyof typeof routes])} options={[
    { value: "clock", label: "Clock" }, { value: "timesheet", label: "Timesheets" },
    { value: "pay", label: "Pay" }, { value: "settings", label: "Settings" },
  ]} />;
}
