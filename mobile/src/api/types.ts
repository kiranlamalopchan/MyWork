/** The shapes apps/api/serialize.py writes, as the app reads them. */

export type Person = {
  username: string;
  name: string;
  initial: string;
  hue: number;
  photo: string | null;
  is_live: boolean;
  is_me: boolean;
};

export type Me = Person & {
  display_name: string;
  email: string;
  phone: string;
  address: string;
  is_staff: boolean;
  holiday_state: string;
  since: string;
};

export type Emoji = { value: string; label: string };

export type ReactionTally = {
  reactions: { emoji: string; count: number }[];
  total_reactions: number;
  my_emoji: string;
  who_reacted: string;
};

export type Comment = ReactionTally & {
  id: number;
  author: Person;
  body: string;
  created: string;
  ago: string;
  mine: boolean;
  parent: number | null;
  replies: Comment[];
  older_replies: number;
};

export type Notice = ReactionTally & {
  id: number;
  author: Person;
  body: string;
  created: string;
  ago: string;
  edited: boolean;
  is_new: boolean;
  mine: boolean;
  comment_total: number;
  comments: Comment[];
  older_comments: number;
};

export type Page<T> = { results: T[]; page: number; pages: number; count: number; next: number | null };

export type Reactors = {
  total: number;
  my_emoji: string;
  groups: { emoji: string; people: Person[] }[];
};

export type PersonPage = {
  person: Person;
  since: string;
  notice_count: number;
  comment_count: number;
  received: number;
  given: number;
  notices: Notice[];
};

export type TrayRow = Person & {
  latest: { id: number; kind: "photo" | "video"; image: string | null };
  count: number;
  unseen: boolean;
  mine: boolean;
};

export type Story = {
  id: number;
  kind: "photo" | "video";
  image: string | null;
  video: string | null;
  duration: number | null;
  caption: string;
  ago: string;
  created: string;
  mine: boolean;
  my_emoji: string;
  reactions: { emoji: string; count: number }[];
  seen_count?: number;
  viewers?: { name: string; ago: string }[];
};

export type StoryPerson = {
  person: Person;
  name: string;
  start: number;
  emoji: Emoji[];
  max_seconds: number;
  stories: Story[];
};

export type Notification = {
  id: number;
  kind: "notice" | "comment" | "reply" | "reaction" | "timesheet";
  icon: string;
  title: string;
  body: string;
  emoji: string;
  url: string;
  actor: Person | null;
  hue: number;
  created: string;
  ago: string;
  read: boolean;
};

export type HolidayCard = {
  name: string;
  date: string;
  month_short: string;
  day: string;
  weekday: string;
  days_remaining: number;
  countdown: string;
  scope: string;
  is_national: boolean;
};

export type Home = {
  holiday: { state: string; holiday: HolidayCard | null };
  stories: TrayRow[];
  notices: Notice[];
  notice_total: number;
  unread: number;
  emoji: Emoji[];
};

export type PluItem = { plu_no: number; description: string };
/** One line of a photographed picking list, named. */
export type PhotoRow = { line: string; item: PluItem; score: number; sureness: "sure" | "likely" | "unsure" | "picked"; by_code: boolean; alternatives: PluItem[] };
export type PhotoRead = { rows: PhotoRow[]; skipped: number };

// ---- TimeSheet -----------------------------------------------------------------

/** A stretch of time as the site prints it: seconds, and its words. */
export type Duration = { seconds: number; hm: string; hms: string; minutes: string; decimal: string };
export type Money = { gross: number; tax: number; net: number };
export type WorkplaceBrief = { id: number; name: string; hue: number; css: string; is_default: boolean };
export type Workplace = WorkplaceBrief & {
  address: string; hourly_rate: number | null; tax_rate: number | null; in_cash: boolean; withholds: boolean;
  paid_in: "BANK" | "CASH"; pay_cycle: "IRREGULAR" | "WEEK" | "FORTNIGHT" | "MONTH"; pay_cycle_label: string;
  hours_limit: number | null; limit_period: "WEEK" | "FORTNIGHT" | "MONTH"; limit_label: string | null;
  week_starts_on: number; fortnight_starts_on: number; fortnight_phase: "this" | "last"; fortnight_hint: string; month_starts_on: number;
  sub: string;
};
export type ShiftStatus = "WORKING" | "ON_BREAK" | "COMPLETED";
export type ShiftRow = {
  id: number; workplace: WorkplaceBrief | null; status: ShiftStatus; status_label: string; is_open: boolean;
  clock_in: string; clock_out: string | null; in_at: string; out_at: string | null; date: string;
  worked: Duration; total_break: Duration; seq: number | null; gap_before: Duration | null;
};
export type Break = { id: number; break_start: string; break_end: string | null; start_at: string; end_at: string | null; is_running: boolean; duration: Duration };
export type ShiftDetail = ShiftRow & {
  date_label: string; total: Duration; pay: Money | null; in_cash: boolean; withholds: boolean; note: string; breaks: Break[];
};
export type LimitCard = {
  workplace: WorkplaceBrief; cap: Duration; used: Duration; remaining: Duration; over: Duration; percent: number;
  settled: Duration; settled_percent: number; since: Duration; since_percent: number; paid_at: string | null;
  period_label: string; period: string; resets_on: string; state: "ok" | "close" | "over";
};
export type PeriodPay = { pay: Money; withheld: boolean; cash: boolean } | null;
export type Summary = {
  cards: { key: string; label: string; sub: string; total: Duration; net: number | null }[];
  period: { key: string; title: string; dates: string; total: Duration; pay: PeriodPay };
  limits: LimitCard[];
};
export type TimesheetDay = { date: string; label: string; total: Duration; is_run: boolean; shifts: ShiftRow[] };
export type TimesheetPage = Page<never> & { days: TimesheetDay[]; workplaces: WorkplaceBrief[]; workplace: number | null; summary: Summary };
export type CalendarCell = { date: string; day: number; in_month: boolean; is_today: boolean; total: Duration | null; track: { css: string; left: number; width: number }[]; lead: string | null };
export type CalendarPage = {
  year: number; month: number; label: string; weekday_labels: string[]; weeks: CalendarCell[][];
  legend: { name: string; css: string; worked: Duration }[]; month_total: Duration; worked_days: number;
  prev: { year: number; month: number }; next: { year: number; month: number };
  selected: string | null; selected_label: string | null; selected_shifts: ShiftRow[]; selected_total: Duration;
};
export type ClockState = {
  server_now: string; today: string; workplaces: WorkplaceBrief[]; selected: number | null;
  shift: {
    id: number; status: ShiftStatus; status_label: string; workplace: WorkplaceBrief | null; clock_in: string; in_at: string;
    worked: Duration; total_break: Duration; banked_break_seconds: number;
    running_break: { start: string; start_at: string; duration: Duration } | null;
  } | null;
  target_hours: number; long_shift: boolean; limit: LimitCard | null; message?: string; finished?: number;
};
export type NewShift = { workplaces: WorkplaceBrief[]; workplace: number | null; clock_in: string; clock_out: string };
export type ShiftInput = { workplace: number | ""; clock_in: string; clock_out: string; note: string; breaks: { id?: number; break_start: string; break_end: string; delete?: boolean }[] };
export type Choice<T = string | number> = { value: T; label: string; css?: string };
export type Cycles = { week_starts_on: number; week_label: string; fortnight_starts_on: number; fortnight_phase: "this" | "last"; fortnight_hint: string; month_starts_on: number };
export type WorkplacesPage = {
  workplaces: Workplace[]; cycles: Cycles;
  choices: { weekdays: Choice<number>[]; phases: Choice[]; colors: Choice<number>[]; pay_cycles: Choice[]; paid_in: Choice[]; limit_periods: Choice[]; max_month_start: number };
};
export type WorkplaceInput = {
  name: string; address: string; color: number | ""; pay_cycle: string; paid_in: string; hourly_rate: string; tax_rate: string;
  hours_limit: string; limit_period: string; week_starts_on: number; fortnight_starts_on: number; fortnight_phase: string; month_starts_on: number | string; is_default: boolean;
};
export type PayRun = { start: string | null; end: string | null; dates: string | null; payday: string | null; hours: number; worked: Duration; shifts: number; pay: Money | null; closed: boolean; payable: boolean };
export type PayRow = {
  workplace: WorkplaceBrief; cycle_label: string; period_label: string; scheduled: boolean; worked: Duration; shifts: number;
  owed_pay: Money | null; since: string | null; earliest: string | null; current: PayRun | null; due: PayRun[];
  covers: Choice[]; last_payment: { covers_through: string; hours: number; amount: number | null } | null;
};
export type PayPage = { owing: PayRow[]; owed_total: Duration; today: string; message?: string };
export type MorePage = { workplace_count: number; unpaid_total: Duration };
export type Activity = {
  week_hours: number; shift_count: number; workplace_count: number; notice_count: number; comment_count: number; reactions_received: number;
  statement: { this_month: [string, string]; last_month: [string, string]; today: string; workplaces: { id: number; name: string }[] };
};
export type PayslipRead = { fields: Record<string, string | number>; read: { label: string; value: string; how: string }[]; notes: string[] };
export type Going = { shifts: number; breaks: number; payments: number; worked: Duration; span: string | null };
