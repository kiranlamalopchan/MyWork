import { Redirect, useLocalSearchParams } from "expo-router";
export default function LegacyTimesheet() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  return <Redirect href={{ pathname: "/work/timesheet", params: view ? { view } : {} }} />;
}
