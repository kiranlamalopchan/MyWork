/**
 * Every call the app makes, typed, in one place — and the react-query
 * hooks and invalidations that keep screens in step after a change.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, FilePart, formWith } from "./client";
import type {
  Home, HolidayCard, Me, Notice, Notification, Page, PersonPage, PluItem, ReactionTally,
  Reactors, Story, StoryPerson, TrayRow,
} from "./types";

export * from "./types";
export { ApiError } from "./client";

// ---- auth --------------------------------------------------------------------

export const auth = {
  login: (username: string, password: string) =>
    api<{ token: string; me: Me }>("auth/login/", { method: "POST", body: { username, password }, anonymous: true }),
  register: (username: string, password: string) =>
    api<{ token: string; me: Me }>("auth/register/", { method: "POST", body: { username, password }, anonymous: true }),
  logout: (device?: string | null) => api("auth/logout/", { method: "POST", body: { device: device || "" } }),
};

// ---- me --------------------------------------------------------------------------

export const me = {
  get: () => api<Me>("me/"),
  update: (fields: Partial<Pick<Me, "display_name" | "email" | "phone" | "address">>) =>
    api<Me>("me/", { method: "PATCH", body: fields }),
  setPhoto: (photo: FilePart) => api<Me>("me/photo/", { method: "POST", form: formWith({ photo }) }),
  clearPhoto: () => api<Me>("me/photo/", { method: "DELETE" }),
  setHolidayState: (state: string) => api<Me>("me/holiday-state/", { method: "PUT", body: { state } }),
  registerDevice: (token: string, platform: string, name: string) =>
    api("devices/", { method: "POST", body: { token, platform, name } }),
};

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: me.get, staleTime: 60_000 });
}

// ---- home ------------------------------------------------------------------------

export function useHome() {
  return useQuery({ queryKey: ["home"], queryFn: () => api<Home>("home/"), staleTime: 15_000 });
}

// ---- the board -----------------------------------------------------------------

export const board = {
  page: (page: number) => api<Page<Notice>>("notices/", { query: { page } }),
  one: (id: number) => api<Notice>(`notices/${id}/`),
  post: (body: string) => api<Notice>("notices/", { method: "POST", body: { body } }),
  edit: (id: number, body: string) => api<Notice>(`notices/${id}/`, { method: "PATCH", body: { body } }),
  remove: (id: number) => api(`notices/${id}/`, { method: "DELETE" }),
  react: (id: number, emoji: string) => api<ReactionTally>(`notices/${id}/react/`, { method: "POST", body: { emoji } }),
  reactors: (id: number) => api<Reactors>(`notices/${id}/reactions/`),
  comment: (id: number, body: string, parent?: number | null) =>
    api<Notice>(`notices/${id}/comments/`, { method: "POST", body: { body, parent: parent || "" } }),
  removeComment: (id: number) => api<Notice>(`comments/${id}/`, { method: "DELETE" }),
  reactComment: (id: number, emoji: string) => api<ReactionTally>(`comments/${id}/react/`, { method: "POST", body: { emoji } }),
  commentReactors: (id: number) => api<Reactors>(`comments/${id}/reactions/`),
  person: (username: string) => api<PersonPage>(`people/${encodeURIComponent(username)}/`),
};

export function useBoard() {
  return useInfiniteQuery({
    queryKey: ["board"],
    queryFn: ({ pageParam }) => board.page(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export function useNotice(id: number) {
  return useQuery({ queryKey: ["notice", id], queryFn: () => board.one(id) });
}

export function usePerson(username: string) {
  return useQuery({ queryKey: ["person", username], queryFn: () => board.person(username) });
}

/** After anything changes on the board, everything that shows it is stale. */
export function useBoardChanged() {
  const client = useQueryClient();
  return (id?: number) => {
    client.invalidateQueries({ queryKey: ["board"] });
    client.invalidateQueries({ queryKey: ["home"] });
    client.invalidateQueries({ queryKey: ["person"] });
    if (id) client.invalidateQueries({ queryKey: ["notice", id] });
  };
}

export function usePostNotice() {
  const changed = useBoardChanged();
  return useMutation({ mutationFn: (body: string) => board.post(body), onSuccess: () => changed() });
}

// ---- stories -------------------------------------------------------------------

export const stories = {
  tray: () => api<{ stories: TrayRow[]; max_seconds: number }>("stories/"),
  person: (username: string) => api<StoryPerson>(`stories/${encodeURIComponent(username)}/`),
  post: (fields: {
    image?: FilePart; video?: FilePart; poster?: FilePart; duration?: number;
    trim_start?: number; trim_end?: number; caption?: string;
  }) => api<{ story: Story; stories: TrayRow[] }>("stories/", { method: "POST", form: formWith(fields) }),
  remove: (id: number) => api<{ stories: TrayRow[] }>(`stories/${id}/`, { method: "DELETE" }),
  seen: (id: number) => api(`stories/${id}/seen/`, { method: "POST" }),
  react: (id: number, emoji: string) =>
    api<{ my_emoji: string; reactions: { emoji: string; count: number }[] }>(`stories/${id}/react/`, { method: "POST", body: { emoji } }),
};

export function useStoryPerson(username: string) {
  return useQuery({ queryKey: ["stories", username], queryFn: () => stories.person(username), staleTime: 0 });
}

export function useStoriesChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["home"] });
    client.invalidateQueries({ queryKey: ["stories"] });
  };
}

// ---- notifications --------------------------------------------------------------

export const inbox = {
  page: (page: number) => api<Page<Notification> & { unread: number }>("notifications/", { query: { page } }),
  unread: () => api<{ unread: number }>("notifications/unread/"),
  readAll: () => api<{ unread: number }>("notifications/read/", { method: "POST" }),
  read: (id: number) => api<{ url: string; unread: number }>(`notifications/${id}/read/`, { method: "POST" }),
};

export function useInbox() {
  return useInfiniteQuery({
    queryKey: ["inbox"],
    queryFn: ({ pageParam }) => inbox.page(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}

export function useUnread() {
  return useQuery({ queryKey: ["unread"], queryFn: inbox.unread, refetchInterval: 60_000, staleTime: 30_000 });
}

export function useInboxChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["inbox"] });
    client.invalidateQueries({ queryKey: ["unread"] });
    client.invalidateQueries({ queryKey: ["home"] });
  };
}

// ---- PLU -----------------------------------------------------------------------------

export const plu = {
  search: (q: string, page: number) => api<Page<PluItem> & { q: string }>("plu/search/", { query: { q, page } }),
  one: (plu_no: number) => api<PluItem>(`plu/${plu_no}/`),
};

export function usePluSearch(q: string) {
  return useInfiniteQuery({
    queryKey: ["plu", q],
    queryFn: ({ pageParam }) => plu.search(q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: q.trim().length > 0,
  });
}

// ---- holidays --------------------------------------------------------------------------

export const holidays = {
  next: (state?: string) => api<{ state: string; holiday: HolidayCard | null }>("holidays/next/", { query: { state } }),
  upcoming: (state?: string) =>
    api<{ state: string; states: string[]; holidays: HolidayCard[] }>("holidays/upcoming/", { query: { state } }),
};

export function useUpcomingHolidays(state?: string) {
  return useQuery({ queryKey: ["holidays", state || "mine"], queryFn: () => holidays.upcoming(state) });
}
