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
