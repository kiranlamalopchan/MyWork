/**
 * Every call the app makes, typed, in one place — and the react-query
 * hooks and invalidations that keep screens in step after a change.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, apiUrl, FilePart, formWith } from "./client";
import { CHUNK_AT, sizeOf, uploadInPieces } from "./chunked";
import type {
  Activity, CalendarPage, ClockState, Cycles, Going, MorePage, NewShift, PayPage, PayslipRead, ShiftDetail, ShiftInput,
  TimesheetPage, Workplace, WorkplaceBrief, WorkplaceInput, WorkplacesPage,
  Friends as FriendsPage, PhotoRead, PluImportable, PluImported,
  Home, HolidayCard, Me, Notice, Notification, Page, PersonPage, PluItem, ReactionTally,
  Reactors, Story, StoryPerson, TrayRow, Visibility,
  BlockedPerson, ReportKind, ReportReason,
} from "./types";

export * from "./types";
export { ApiError } from "./client";

// ---- auth --------------------------------------------------------------------

export const auth = {
  login: (username: string, password: string) =>
    api<{ token: string; me: Me }>("auth/login/", { method: "POST", body: { username, password }, anonymous: true }),
  register: (username: string, password: string) =>
    api<{ token: string; me: Me }>("auth/register/", { method: "POST", body: { username, password }, anonymous: true }),
  /** `keep` leaves the token alive on the server: it is behind the phone's lock for next time. */
  logout: (device?: string | null, keep = false) => api("auth/logout/", { method: "POST", body: { device: device || "", keep_token: keep } }),
};

// ---- me --------------------------------------------------------------------------

export const me = {
  get: () => api<Me>("me/"),
  update: (fields: Partial<Pick<Me, "username" | "display_name" | "email" | "phone" | "address">>) =>
    api<Me>("me/", { method: "PATCH", body: fields }),
  setPhoto: (photo: FilePart) => api<Me>("me/photo/", { method: "POST", form: formWith({ photo }) }),
  clearPhoto: () => api<Me>("me/photo/", { method: "DELETE" }),
  setHolidayState: (state: string) => api<Me>("me/holiday-state/", { method: "PUT", body: { state } }),
  registerDevice: (token: string, platform: string, name: string) =>
    api("devices/", { method: "POST", body: { token, platform, name } }),
  unregisterDevice: (token: string) => api("devices/", { method: "DELETE", body: { token } }),
  /** The account and everything in it, behind the password. */
  deleteAccount: (password: string) => api("me/", { method: "DELETE", body: { password } }),
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
  post: (body: string, visibility: Visibility = "public") =>
    api<Notice>("notices/", { method: "POST", body: { body, visibility } }),
  edit: (id: number, body: string, visibility: Visibility = "public") =>
    api<Notice>(`notices/${id}/`, { method: "PATCH", body: { body, visibility } }),
  remove: (id: number) => api(`notices/${id}/`, { method: "DELETE" }),
  react: (id: number, emoji: string) => api<ReactionTally>(`notices/${id}/react/`, { method: "POST", body: { emoji } }),
  reactors: (id: number) => api<Reactors>(`notices/${id}/reactions/`),
  comment: (id: number, body: string, parent?: number | null, visibility: Visibility = "public") =>
    api<Notice>(`notices/${id}/comments/`, { method: "POST", body: { body, parent: parent || "", visibility } }),
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

/** Blocking a person and reporting a post — apps.moderation on the server. */
export const safety = {
  block: (username: string) => api<{ blocked: boolean; detail: string }>(`people/${encodeURIComponent(username)}/block/`, { method: "POST" }),
  unblock: (username: string) => api<{ blocked: boolean; detail: string }>(`people/${encodeURIComponent(username)}/block/`, { method: "DELETE" }),
  blocked: () => api<{ people: BlockedPerson[] }>("me/blocked/"),
  reasons: () => api<{ reasons: ReportReason[] }>("report/"),
  report: (kind: ReportKind, id: number, reason: string, note = "") =>
    api<{ detail: string }>("report/", { method: "POST", body: { kind, id, reason, note } }),
};

export function useBlocked() {
  return useQuery({ queryKey: ["blocked"], queryFn: safety.blocked });
}

export function useReportReasons() {
  return useQuery({ queryKey: ["report-reasons"], queryFn: safety.reasons, staleTime: Infinity });
}

/** After a block or unblock, everything that shows people is stale. */
export function useSafetyChanged() {
  const client = useQueryClient();
  return () => {
    for (const key of ["board", "home", "person", "notice", "blocked", "friends", "stories", "inbox"]) {
      client.invalidateQueries({ queryKey: [key] });
    }
  };
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
  return useMutation({
    mutationFn: ({ body, visibility }: { body: string; visibility?: Visibility }) => board.post(body, visibility),
    onSuccess: () => changed(),
  });
}

// ---- friends ---------------------------------------------------------------------

export const friends = {
  list: (q?: string) => api<FriendsPage>("friends/", { query: { q } }),
  request: (username: string) => api<{ status: "sent" | "friends" }>(`friends/request/${encodeURIComponent(username)}/`, { method: "POST" }),
  accept: (id: number) => api<{ status: "friends" }>(`friends/accept/${id}/`, { method: "POST" }),
  decline: (id: number) => api(`friends/decline/${id}/`, { method: "POST" }),
  remove: (username: string) => api(`friends/remove/${encodeURIComponent(username)}/`, { method: "POST" }),
};

export function useFriends(q?: string) {
  return useQuery({ queryKey: ["friends", q || ""], queryFn: () => friends.list(q) });
}

export function useFriendsChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["friends"] });
    // The Friends tally on the profile, and any friends-only post's audience.
    client.invalidateQueries({ queryKey: ["activity"] });
    client.invalidateQueries({ queryKey: ["board"] });
    client.invalidateQueries({ queryKey: ["home"] });
  };
}

// ---- stories -------------------------------------------------------------------

export const stories = {
  tray: () => api<{ stories: TrayRow[]; max_seconds: number }>("stories/"),
  person: (username: string) => api<StoryPerson>(`stories/${encodeURIComponent(username)}/`),
  post: async (fields: {
    image?: FilePart; video?: FilePart; poster?: FilePart; duration?: number;
    trim_start?: number; trim_end?: number; caption?: string; visibility?: Visibility;
  }, onProgress?: (sent: number) => void) => {
    // A video too big for one request goes in pieces first (api/chunked),
    // and the story names the assembled upload instead of carrying the file.
    const { video, ...rest } = fields;
    const size = video ? await sizeOf(video) : null;
    if (video && size !== null && size > CHUNK_AT) {
      const upload_id = await uploadInPieces(video, size, (p) => onProgress?.(p * 0.95));
      return api<{ story: Story; stories: TrayRow[] }>("stories/", { method: "POST", form: formWith({ ...rest, upload_id, filename: video.name }), onProgress: (p) => onProgress?.(0.95 + p * 0.05) });
    }
    return api<{ story: Story; stories: TrayRow[] }>("stories/", { method: "POST", form: formWith(fields), onProgress });
  },
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
  search: (q: string, page: number) => api<Page<PluItem> & { q: string; total?: number }>("plu/search/", { query: { q, page } }),
  /** What the box shows before anything is typed: how many codes, and a few of them. */
  idle: () => api<{ total: number; samples: PluItem[] }>("plu/search/", { query: { q: "" } }),
  one: (plu_no: number) => api<PluItem>(`plu/${plu_no}/`),
  /** A photographed picking list: every line named as a PLU. */
  photo: (photo: FilePart) => api<PhotoRead>("plu/photo/", { method: "POST", form: formWith({ photo }) }),
  photoPdfUrl: () => apiUrl("plu/photo/pdf/"),
  /** Whether this account may import the list, and what the file needs. */
  importable: () => api<PluImportable>("plu/import/"),
  /** The whole list, replaced from a CSV. Managers only; the server says so too. */
  importCsv: (file: FilePart, onProgress?: (sent: number) => void) =>
    api<PluImported>("plu/import/", { method: "POST", form: formWith({ file }), onProgress }),
};

/** Whether the import button belongs on this phone's screen at all. */
export function usePluImportable() {
  return useQuery({ queryKey: ["plu-importable"], queryFn: plu.importable, staleTime: 5 * 60_000 });
}

/** After an import: every search and every count is of the old list. */
export function usePluChanged() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ["plu"] });
    client.invalidateQueries({ queryKey: ["plu-total"] });
    client.invalidateQueries({ queryKey: ["plu-importable"] });
  };
}

export function usePluSearch(q: string) {
  return useInfiniteQuery({
    queryKey: ["plu", q],
    queryFn: ({ pageParam }) => plu.search(q, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: q.trim().length > 0,
  });
}

export function usePluIdle() {
  return useQuery({ queryKey: ["plu-idle"], queryFn: plu.idle, staleTime: 5 * 60_000 });
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

// ---- TimeSheet -----------------------------------------------------------------

/** The phone's own clock, stamped on every clock action as the site's forms do. */
function stamp() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, "0")}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* no zone */ }
  return { client_time: iso, client_tz: tz };
}

export const timesheet = {
  clock: (workplace?: number) => api<ClockState>("timesheet/clock/", { query: { workplace } }),
  clockIn: (workplace: number) => api<ClockState>("timesheet/clock-in/", { method: "POST", body: { workplace, ...stamp() } }),
  startBreak: () => api<ClockState>("timesheet/break/start/", { method: "POST", body: stamp() }),
  endBreak: () => api<ClockState>("timesheet/break/end/", { method: "POST", body: stamp() }),
  clockOut: () => api<ClockState>("timesheet/clock-out/", { method: "POST", body: stamp() }),
  page: (page: number, workplace?: number | null) => api<TimesheetPage>("timesheet/", { query: { page, workplace: workplace ?? undefined } }),
  calendar: (year?: number, month?: number, day?: string | null) => api<CalendarPage>("timesheet/calendar/", { query: { year, month, day: day ?? undefined } }),
  newShift: (day?: string) => api<NewShift>("timesheet/shifts/new/", { query: { day } }),
  shift: (id: number) => api<ShiftDetail>(`timesheet/shifts/${id}/`),
  addShift: (input: ShiftInput) => api<ShiftDetail>("timesheet/shifts/", { method: "POST", body: input }),
  editShift: (id: number, input: ShiftInput) => api<ShiftDetail>(`timesheet/shifts/${id}/`, { method: "PATCH", body: input }),
  removeShift: (id: number) => api(`timesheet/shifts/${id}/`, { method: "DELETE" }),
  workplaces: () => api<WorkplacesPage>("timesheet/workplaces/"),
  workplace: (id: number) => api<Workplace>(`timesheet/workplaces/${id}/`),
  addWorkplace: (input: WorkplaceInput) => api<Workplace>("timesheet/workplaces/", { method: "POST", body: input }),
  editWorkplace: (id: number, input: WorkplaceInput) => api<Workplace>(`timesheet/workplaces/${id}/`, { method: "PATCH", body: input }),
  removal: (id: number) => api<{ workplace: WorkplaceBrief; going: Going; clocked_in: boolean }>(`timesheet/workplaces/${id}/removal/`),
  removeWorkplace: (id: number) => api<{ removed: Going }>(`timesheet/workplaces/${id}/`, { method: "DELETE" }),
  makeDefault: (id: number) => api<Workplace>(`timesheet/workplaces/${id}/default/`, { method: "POST" }),
  readPayslip: (payslip: FilePart) => api<PayslipRead>("timesheet/workplaces/payslip/", { method: "POST", form: formWith({ payslip }) }),
  savePreferences: (input: Omit<Cycles, "week_label" | "fortnight_hint">) => api<Cycles>("timesheet/preferences/", { method: "PUT", body: input }),
  pay: () => api<PayPage>("timesheet/pay/"),
  recordPayment: (id: number, covers: string, up_to?: string) => api<PayPage>(`timesheet/pay/${id}/received/`, { method: "POST", body: { covers, up_to: up_to || "" } }),
  undoPayment: (id: number) => api<PayPage>(`timesheet/pay/${id}/undo/`, { method: "POST" }),
  more: () => api<MorePage>("timesheet/more/"),
  activity: () => api<Activity>("me/activity/"),
  statementUrl: (from: string, to: string, workplace?: number | "") => apiUrl(`timesheet/statement/?from=${from}&to=${to}${workplace ? `&workplace=${workplace}` : ""}`),
};

/**
 * The clock, for the job asked about. The cap under the dial is that job's
 * alone, so the workplace is part of the key: picking another has to ask
 * again, or the bar goes on describing the one you were looking at before.
 */
export function useClock(workplace?: number | null, enabled = true) {
  return useQuery({
    queryKey: ["clock", workplace ?? null],
    queryFn: () => timesheet.clock(workplace ?? undefined),
    staleTime: 10_000,
    enabled,
  });
}
export function useTimesheet(workplace: number | null) {
  return useInfiniteQuery({
    queryKey: ["timesheet", workplace],
    queryFn: ({ pageParam }) => timesheet.page(pageParam, workplace),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
  });
}
export function useCalendar(year?: number, month?: number, day?: string | null) {
  return useQuery({ queryKey: ["calendar", year, month, day], queryFn: () => timesheet.calendar(year, month, day) });
}
export function useShift(id: number) {
  return useQuery({ queryKey: ["shift", id], queryFn: () => timesheet.shift(id) });
}
export function useWorkplaces() {
  return useQuery({ queryKey: ["workplaces"], queryFn: timesheet.workplaces });
}
export function usePay() {
  return useQuery({ queryKey: ["pay"], queryFn: timesheet.pay });
}
export function useMore() {
  return useQuery({ queryKey: ["more"], queryFn: timesheet.more, staleTime: 15_000 });
}
export function useActivity() {
  return useQuery({ queryKey: ["activity"], queryFn: timesheet.activity });
}

/** After the clock moves or a shift, workplace or payment changes, every figure is stale. */
export function useTimesheetChanged() {
  const client = useQueryClient();
  return () => {
    for (const key of ["clock", "timesheet", "calendar", "shift", "workplaces", "pay", "more", "activity", "home"]) {
      client.invalidateQueries({ queryKey: [key] });
    }
  };
}
