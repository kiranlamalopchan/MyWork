import { Redirect } from "expo-router";
/** Retain links from existing push notifications and older app routes. */
export default function NotificationsRoute() { return <Redirect href="/alerts" />; }
