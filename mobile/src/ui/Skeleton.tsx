/**
 * The shape of what is coming, breathing while it loads: grey blocks in
 * the places the words, faces and badges will take, all pulsing together.
 * A screen shows one of these instead of a spinner, so the eye already
 * knows where to look when the data lands — and nothing jumps when it does,
 * because each skeleton is cut to the screen it stands in for.
 *
 * `Bone` is the block; the rest are the screens, named for them.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";

import { Card } from "./index";
import { useLayout } from "./layout";
import { alpha, mix, radius, sp, useTheme } from "./theme";

/**
 * One shared pulse so every block on a screen breathes in step — running
 * only while there is a block to breathe: the last one off screen stops it.
 */
const pulse = new Animated.Value(0);
let loop: Animated.CompositeAnimation | null = null;
let bones = 0;
function usePulse() {
  useEffect(() => {
    if (bones++ === 0) {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      loop.start();
    }
    return () => {
      if (--bones === 0) { loop?.stop(); loop = null; pulse.setValue(0); }
    };
  }, []);
  return pulse;
}

export function Bone({ width = "100%", height = 14, round = 8, colour, fill, style }: {
  width?: DimensionValue; height?: number; round?: number; colour?: string; fill?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const pulse = usePulse();
  const opacity = useRef(pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] })).current;
  return <Animated.View style={[{ width: fill ? undefined : width, flex: fill ? 1 : undefined, height, borderRadius: round, backgroundColor: colour || t.surface3, opacity }, style]} />;
}

/** A face-shaped bone. */
function Face({ size, colour }: { size: number; colour?: string }) {
  return <Bone width={size} height={size} round={size / 2} colour={colour} />;
}

/** A few lines of text: the first the widest, the last the shortest. */
function Lines({ widths, height = 14, gap = 8, colour }: { widths: DimensionValue[]; height?: number; gap?: number; colour?: string }) {
  return (
    <View style={{ gap }}>
      {widths.map((w, i) => <Bone key={i} width={w} height={height} colour={colour} />)}
    </View>
  );
}

/** A pill-shaped button. */
function Pill({ width, height = 52, colour }: { width: DimensionValue; height?: number; colour?: string }) {
  return <Bone width={width} height={height} round={radius.pill} colour={colour} />;
}

/** A ledger: a label on the left and a figure on the right, so many rows. */
function LedgerBones({ rows, colour }: { rows: number; colour?: string }) {
  return (
    <View style={{ gap: sp[3] }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.between}>
          <Bone width={`${34 + ((i * 13) % 22)}%`} height={13} colour={colour} />
          <Bone width={`${14 + ((i * 7) % 10)}%`} height={13} colour={colour} />
        </View>
      ))}
    </View>
  );
}

/** The page's big title and, when it has one, the line under it. */
export function SkeletonTitle({ sub, width = "55%" }: { sub?: boolean; width?: DimensionValue }) {
  return (
    <View style={{ paddingTop: sp[2], gap: sp[2] }}>
      <Bone width={width} height={30} round={10} />
      {sub ? <Bone width="80%" height={14} /> : null}
    </View>
  );
}

/** A form: so many labelled fields, then the two buttons under them. */
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <>
      <Card style={{ gap: sp[4] }}>
        {Array.from({ length: fields }, (_, i) => (
          <View key={i} style={{ gap: sp[2] }}>
            <Bone width={`${28 + ((i * 17) % 30)}%`} height={13} />
            <Bone height={52} round={radius.md} />
          </View>
        ))}
      </Card>
      <Pill width="100%" />
      <Pill width="100%" />
    </>
  );
}

// ---- PLU ------------------------------------------------------------------------

/** A list of rows, each a badge and two lines — a PLU result before it arrives. */
export function SkeletonRows({ count = 6, badge = true, style }: { count?: number; badge?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.list, { backgroundColor: t.surface, borderColor: t.dark ? t.line : "transparent" }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
          {badge ? <Bone width={58} height={36} round={radius.sm} /> : null}
          <View style={{ flex: 1, gap: 8 }}>
            <Bone width={`${55 + ((i * 17) % 35)}%`} height={15} />
            <Bone width={`${25 + ((i * 11) % 30)}%`} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** One PLU: the code large on its card, then the two buttons. */
export function SkeletonPlu() {
  return (
    <>
      <Card style={{ alignItems: "center", paddingVertical: sp[8], gap: sp[3] }}>
        <Bone width={70} height={12} />
        <Bone width={180} height={60} round={14} />
        <Bone width="70%" height={18} />
      </Card>
      <View style={{ gap: sp[3] }}>
        <Pill width="100%" />
        <Pill width="100%" />
      </View>
    </>
  );
}

// ---- the board ------------------------------------------------------------------

/** A notice as NoticeCard draws it: the author line, the words, the two acts. */
export function SkeletonNotice({ lines = 3, comments = 0 }: { lines?: number; comments?: number }) {
  const t = useTheme();
  const widths = (["100%", "92%", "64%", "80%", "45%"] as DimensionValue[]).slice(0, lines);
  return (
    <Card pad={false} style={styles.notice}>
      <View style={styles.author}>
        <Face size={42} />
        <View style={{ flex: 1, gap: 7 }}>
          <Bone width="38%" height={15} />
          <Bone width="26%" height={11} />
        </View>
      </View>
      <Lines widths={widths} height={15} gap={9} />
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />
      <View style={styles.acts}>
        <Bone width={64} height={18} />
        <Bone width={84} height={18} />
      </View>
      {comments ? (
        <View style={{ gap: sp[3] }}>
          {Array.from({ length: comments }, (_, i) => (
            <View key={i} style={styles.comment}>
              <Face size={32} />
              <View style={[styles.bubble, { backgroundColor: t.surface2, width: `${58 + ((i * 19) % 30)}%` }]}>
                <Bone width="40%" height={11} />
                <Bone width="88%" height={13} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function SkeletonNotices({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => <SkeletonNotice key={i} lines={2 + (i % 3)} comments={i === 0 ? 1 : 0} />)}
    </>
  );
}

/** The hub: the next holiday, the stories, then the board's first few. */
export function SkeletonHome() {
  const t = useTheme();
  const layout = useLayout();
  const tint = mix(t.brand, t.surface, 0.1);
  const onTint = alpha(t.brand, 0.16);
  const W = Math.round(Math.min(112, Math.max(88, (layout.width - 2 * layout.gutter - 2 * sp[2]) / 3.3)));
  const H = Math.round((W * 16) / 9);
  return (
    <>
      <View style={[styles.hero, { backgroundColor: tint }]}>
        <View style={{ flex: 1, gap: sp[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
            <Bone width={96} height={11} colour={onTint} />
            <Bone width={44} height={16} round={999} colour={onTint} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
            <Bone width={52} height={54} round={radius.md} colour={t.surface} />
            <View style={{ flex: 1, gap: 7 }}>
              <Bone width="70%" height={17} colour={onTint} />
              <Bone width="40%" height={12} colour={onTint} />
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
            <Bone width={90} height={26} round={999} colour={alpha(t.warn, 0.14)} />
            <Bone width={108} height={30} round={999} colour={t.surface} />
          </View>
        </View>
        <Bone width="36%" height={H * 0.62} round={radius.lg} colour={onTint} style={{ minWidth: 100, maxWidth: 160 }} />
      </View>
      <View style={{ flexDirection: "row", gap: sp[2], paddingTop: 2, paddingBottom: sp[2], overflow: "hidden" }}>
        {Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={{ width: W, height: H, borderRadius: radius.md, backgroundColor: t.surface3, overflow: "hidden" }}>
            <View style={{ position: "absolute", top: 8, left: 8 }}><Face size={32} colour={t.surface2} /></View>
            <View style={{ position: "absolute", bottom: 8, left: 8, right: 8 }}><Bone width="75%" height={11} colour={t.surface2} /></View>
          </View>
        ))}
      </View>
      <View style={{ gap: sp[3] }}>
        <View style={styles.between}>
          <View style={{ gap: 6 }}>
            <Bone width={128} height={20} round={7} />
            <Bone width={64} height={12} />
          </View>
          <Pill width={78} height={38} colour={alpha(t.brand, 0.3)} />
        </View>
        <SkeletonNotice lines={3} comments={1} />
        <SkeletonNotice lines={2} />
      </View>
    </>
  );
}

/** The inbox: a day's heading, then a row a notification each. */
export function SkeletonNotifications({ count = 6 }: { count?: number }) {
  return (
    <View style={{ marginTop: sp[1] }}>
      {Array.from({ length: count }, (_, i) => (
        <React.Fragment key={i}>
          {i === 0 || i === 3 ? <View style={{ marginBottom: sp[3], marginTop: i ? sp[5] : 0, paddingHorizontal: 2 }}><Bone width={i ? 96 : 60} height={18} round={6} /></View> : null}
          <Card pad={false} style={{ marginBottom: sp[2] }}>
            <View style={styles.inboxRow}>
              <Face size={40} />
              <View style={{ flex: 1, gap: 7 }}>
                <Bone width={`${60 + ((i * 13) % 30)}%`} height={15} />
                <Bone width={`${70 + ((i * 7) % 25)}%`} height={13} />
                <Bone width={48} height={11} />
              </View>
            </View>
          </Card>
        </React.Fragment>
      ))}
    </View>
  );
}

/** Reactions: a card a face each, the people who left it under. */
export function SkeletonReactions() {
  const t = useTheme();
  return (
    <>
      <SkeletonTitle sub width="45%" />
      {[3, 2].map((people, g) => (
        <Card key={g} pad={false}>
          <View style={[styles.groupHead, { borderBottomColor: t.line }]}>
            <Face size={22} />
            <Bone width={18} height={14} />
          </View>
          {Array.from({ length: people }, (_, i) => (
            <View key={i} style={[styles.personRow, { borderTopColor: t.line, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
              <Face size={32} />
              <Bone width={`${30 + ((i * 17) % 25)}%`} height={14} />
              <View style={{ flex: 1 }} />
              <Face size={20} />
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}

/** Somebody's page: their face and name, four counts, then their notices. */
export function SkeletonPerson() {
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: sp[4], paddingTop: sp[4] }}>
        <Face size={72} />
        <View style={{ flex: 1, gap: 8 }}>
          <Bone width="55%" height={22} round={7} />
          <Bone width="75%" height={14} />
        </View>
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} pad={false} style={{ width: "47%", flexGrow: 1, padding: sp[4], gap: 8 }}>
            <Bone width={36} height={22} round={7} />
            <Bone width={`${45 + ((i * 23) % 40)}%`} height={13} />
          </Card>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: sp[2] }}>
        <Face size={18} />
        <Bone width={120} height={18} round={6} />
      </View>
      <SkeletonNotice lines={3} />
    </>
  );
}

/** Friends, inside its fold: a list block under its label, then the search. */
export function SkeletonFriends() {
  const t = useTheme();
  const block = t.dark ? t.surface3 : t.surface2;
  const bone = t.dark ? t.lineStrong : t.surface3;
  return (
    <>
      <View style={{ gap: sp[2] }}>
        <Bone width={84} height={11} />
        <View style={[styles.friendList, { backgroundColor: block }]}>
          {Array.from({ length: 2 }, (_, i) => (
            <View key={i} style={[styles.friendRow, { borderBottomColor: t.line, borderBottomWidth: i ? 0 : StyleSheet.hairlineWidth }]}>
              <Face size={38} colour={bone} />
              <View style={{ flex: 1, gap: 6 }}>
                <Bone width={`${40 + i * 15}%`} height={14} colour={bone} />
                <Bone width="28%" height={11} colour={bone} />
              </View>
              <Face size={22} colour={bone} />
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: sp[2] }}>
        <Bone width={92} height={11} />
        <Bone height={52} round={radius.md} colour={block} />
      </View>
    </>
  );
}

// ---- the timesheet --------------------------------------------------------------

/** A card of shift rows: the bar down the side, the place, the times, the total. */
export function SkeletonShiftRows({ count = 3 }: { count?: number }) {
  const t = useTheme();
  return (
    <Card pad={false}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.shift, { borderBottomColor: t.line, borderBottomWidth: i === count - 1 ? 0 : StyleSheet.hairlineWidth }]}>
          <Bone width={4} height={36} round={2} colour={alpha(t.brand, 0.3)} />
          <View style={{ flex: 1, gap: 7 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
              <Face size={10} />
              <Bone width={`${40 + ((i * 17) % 30)}%`} height={15} />
            </View>
            <Bone width="55%" height={12} />
          </View>
          <Bone width={44} height={15} />
          <Bone width={10} height={16} round={3} />
        </View>
      ))}
    </Card>
  );
}

/** The timesheet's list: the summary cards, this period's pay, then today's shifts. */
export function SkeletonTimesheet() {
  const t = useTheme();
  const onHero = t.heroChip;
  return (
    <>
      <View style={{ flexDirection: "row", gap: sp[2] }}>
        {Array.from({ length: 3 }, (_, i) => <Pill key={i} width={i === 0 ? 56 : 104} height={40} colour={t.surface} />)}
      </View>
      <View style={styles.grid}>
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i} pad={false} style={{ flexGrow: 1, width: "30%", padding: sp[4], gap: 8 }}>
            <Bone width="60%" height={12} />
            <Bone width="70%" height={26} round={8} />
            <Bone width="50%" height={11} />
          </Card>
        ))}
      </View>
      <Card pad={false} style={{ overflow: "hidden" }}>
        <View style={{ padding: sp[5], gap: 8, backgroundColor: t.hero }}>
          <View style={styles.between}>
            <Bone width={96} height={12} colour={onHero} />
            <Bone width={110} height={12} colour={onHero} />
          </View>
          <Bone width="55%" height={38} round={10} colour={onHero} />
          <Bone width="45%" height={13} colour={onHero} />
        </View>
        <View style={{ padding: sp[5], paddingTop: sp[4], gap: sp[3] }}>
          <LedgerBones rows={3} />
          <Bone width="90%" height={12} />
        </View>
      </Card>
      <View style={[styles.between, { paddingVertical: sp[3], paddingHorizontal: sp[1] }]}>
        <Bone width={120} height={17} round={6} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
          <Bone width={48} height={12} />
          <Bone width={40} height={14} />
          <Bone width={16} height={16} round={4} />
        </View>
      </View>
      <SkeletonShiftRows count={2} />
    </>
  );
}

/** The month, a cell a day, and the key under it. */
export function SkeletonCalendar() {
  const t = useTheme();
  return (
    <Card pad={false} style={{ padding: sp[3] }}>
      <View style={[styles.between, { gap: sp[2], marginBottom: sp[2] }]}>
        <Face size={44} colour={t.surface2} />
        <View style={{ alignItems: "center", gap: 6, flex: 1 }}>
          <Bone width={130} height={18} round={6} />
          <Bone width={96} height={12} />
        </View>
        <Face size={44} colour={t.surface2} />
      </View>
      <View style={styles.calRow}>
        {Array.from({ length: 7 }, (_, i) => <View key={i} style={{ flex: 1, alignItems: "center" }}><Bone width={18} height={10} /></View>)}
      </View>
      {Array.from({ length: 5 }, (_, w) => (
        <View key={w} style={styles.calRow}>
          {Array.from({ length: 7 }, (_, d) => <Bone key={d} fill height={54} round={radius.sm} colour={(w * 7 + d) % 4 === 1 ? t.surface3 : t.surface2} />)}
        </View>
      ))}
      <View style={[styles.legend, { borderTopColor: t.line }]}>
        {Array.from({ length: 2 }, (_, i) => (
          <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Face size={12} />
            <Bone width={72} height={13} />
            <Bone width={36} height={12} />
          </View>
        ))}
      </View>
    </Card>
  );
}

/** The clock: its status line, the dial, where you are, the big button. */
export function SkeletonClock() {
  const t = useTheme();
  const layout = useLayout();
  const DIAL = Math.round(Math.min(300, Math.max(220, layout.width - 2 * layout.gutter - 60)));
  const ring = t.dark ? t.surface3 : t.surface2;
  return (
    <>
      <View style={styles.between}>
        <Pill width={110} height={30} />
        <Bone width={120} height={12} />
      </View>
      <View style={{ width: DIAL, height: DIAL, alignSelf: "center", alignItems: "center", justifyContent: "center", marginVertical: sp[2] }}>
        <View style={{ position: "absolute", width: DIAL, height: DIAL, borderRadius: DIAL / 2, borderWidth: Math.round(DIAL * 8 / 120), borderColor: ring }} />
        <View style={{ position: "absolute", width: DIAL * 0.87, height: DIAL * 0.87, borderRadius: DIAL * 0.435, backgroundColor: t.surface, borderWidth: 1, borderColor: t.dark ? t.line : "transparent" }} />
        <View style={{ alignItems: "center", gap: sp[2] }}>
          <Bone width={90} height={10} />
          <Bone width={DIAL * 0.5} height={Math.round(46 * (DIAL / 280))} round={12} />
          <Bone width={130} height={12} />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: sp[2] }}>
        <Face size={18} />
        <Bone width={140} height={17} round={6} />
      </View>
      <Pill width="100%" height={58} colour={alpha(t.brand, 0.3)} />
      <Card style={{ gap: sp[3] }}>
        <View style={styles.between}>
          <Bone width={120} height={14} />
          <Bone width={60} height={14} />
        </View>
        <Bone height={8} round={4} />
        <Bone width="60%" height={12} />
      </Card>
    </>
  );
}

/** A shift: the hours large, the ledger, the breaks, the two buttons. */
export function SkeletonShift() {
  const t = useTheme();
  return (
    <>
      <Card pad={false} style={{ alignItems: "center", gap: sp[3], paddingVertical: sp[6], paddingHorizontal: sp[4], backgroundColor: mix(t.brand, t.surface, 0.08) }}>
        <Pill width={100} height={30} colour={alpha(t.brand, 0.2)} />
        <Bone width={150} height={50} round={12} />
        <Bone width="60%" height={13} />
      </Card>
      <Card><LedgerBones rows={6} /></Card>
      <Card style={{ gap: sp[2] }}>
        <View style={[styles.between, { marginBottom: sp[1] }]}>
          <Bone width={56} height={13} />
          <Bone width={44} height={12} />
        </View>
        {Array.from({ length: 2 }, (_, i) => (
          <View key={i} style={[styles.brk, { backgroundColor: t.surface2 }]}>
            <Face size={26} />
            <Bone width="50%" height={14} />
            <View style={{ flex: 1 }} />
            <Bone width={44} height={14} />
          </View>
        ))}
      </Card>
      <View style={{ gap: sp[3] }}>
        <Pill width="100%" colour={alpha(t.brand, 0.3)} />
        <Pill width="100%" colour={t.dangerSoft} />
      </View>
    </>
  );
}

/** Pay: what is owed over everything, then a card a job. */
export function SkeletonPay() {
  const t = useTheme();
  const { wide } = useLayout();
  const tint = mix(t.warn, t.surface, 0.1);
  const onTint = alpha(t.warn, 0.14);
  return (
    <>
      <View style={{ borderRadius: radius.lg, padding: sp[4], gap: 8, backgroundColor: tint }}>
        <Bone width={110} height={11} colour={onTint} />
        <Bone width="50%" height={30} round={9} colour={onTint} />
        <Bone width="70%" height={12} colour={onTint} />
      </View>
      <View style={wide && styles.gridWide}>
        {Array.from({ length: 2 }, (_, i) => (
          <View key={i} style={wide && styles.cellWide}>
            <Card pad={false} style={{ padding: sp[4], gap: sp[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
                <Bone width={42} height={42} round={14} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Bone width={`${45 + i * 20}%`} height={16} />
                  <Bone width="35%" height={12} />
                </View>
                <Pill width={82} height={26} colour={alpha(t.brand, 0.13)} />
              </View>
              <View style={{ gap: 8, marginTop: sp[1] }}>
                <Bone width="40%" height={34} round={9} />
                <Bone width="70%" height={13} />
              </View>
              <Pill width="100%" height={48} />
            </Card>
          </View>
        ))}
      </View>
    </>
  );
}

/** Your workplaces: a card a job, the pay cycles, the button to add one. */
export function SkeletonWorkplaces() {
  const t = useTheme();
  const { wide } = useLayout();
  return (
    <>
      <View style={wide && styles.gridWide}>
        {Array.from({ length: 2 }, (_, i) => (
          <View key={i} style={[wide && styles.cellWide, !wide && i ? { marginTop: sp[4] } : null]}>
            <Card pad={false} style={{ padding: sp[4], gap: sp[3] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: sp[3] }}>
                <Bone width={44} height={44} round={radius.md} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
                    <Bone width={`${40 + i * 15}%`} height={16} />
                    {i === 0 ? <Bone width={64} height={16} round={999} colour={alpha(t.brand, 0.14)} /> : null}
                  </View>
                  <Bone width="55%" height={12} />
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: sp[2] }}>
                {[72, 96, 60].map((w, j) => <Bone key={j} width={w} height={26} round={999} colour={alpha(t.brand, 0.11)} />)}
              </View>
              <View style={[styles.between, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: sp[3] }]}>
                <Bone width={90} height={14} />
                <Bone width={70} height={14} />
              </View>
            </Card>
          </View>
        ))}
      </View>
      <Card style={{ gap: sp[3] }}>
        <Bone width={120} height={14} />
        <LedgerBones rows={2} />
      </Card>
      <Pill width="100%" colour={alpha(t.brand, 0.3)} />
    </>
  );
}

/** Removing a workplace: the question, what goes with it, the buttons. */
export function SkeletonRemove() {
  return (
    <>
      <SkeletonTitle width="70%" />
      <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2], marginTop: -sp[2] }}>
        <Face size={12} />
        <Bone width={150} height={13} />
      </View>
      <Card style={{ gap: sp[3] }}>
        <Bone width={110} height={13} />
        <LedgerBones rows={3} />
        <Bone width="95%" height={12} />
      </Card>
      <Pill width="100%" />
      <Pill width="100%" />
    </>
  );
}

// ---- holidays and stories -------------------------------------------------------

/** Public holidays: a month's heading, the dates in it, the months after shut. */
export function SkeletonHolidays() {
  const t = useTheme();
  return (
    <>
      <View style={[styles.month, { borderBottomColor: t.line }]}>
        <Bone width={150} height={18} round={6} />
        <Bone width={16} height={16} round={4} />
      </View>
      <View style={{ gap: sp[2], paddingTop: sp[3] }}>
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} pad={false} style={styles.holiday}>
            <Bone width={48} height={50} round={radius.md} colour={alpha(t.brand, 0.09)} />
            <View style={{ flex: 1, gap: 7 }}>
              <Bone width={`${45 + ((i * 19) % 40)}%`} height={16} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
                <Bone width="40%" height={13} />
                <Bone width={52} height={18} round={999} colour={t.brandSoft} />
              </View>
            </View>
          </Card>
        ))}
      </View>
      {Array.from({ length: 3 }, (_, i) => (
        <View key={i} style={[styles.month, { borderBottomColor: t.line }]}>
          <Bone width={110 + (i % 2) * 30} height={18} round={6} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
            <Bone width={48} height={13} />
            <Bone width={16} height={16} round={4} />
          </View>
        </View>
      ))}
    </>
  );
}

/** A story before its picture: the bars across the top and who it is. */
export function SkeletonStory({ top }: { top: number }) {
  const bone = "rgba(255,255,255,0.22)";
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: sp[3], paddingTop: top + 8, gap: sp[3] }}>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {Array.from({ length: 3 }, (_, i) => <Bone key={i} fill height={3} round={2} colour={bone} />)}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: sp[2] }}>
          <Face size={36} colour={bone} />
          <View style={{ gap: 6 }}>
            <Bone width={110} height={13} colour={bone} />
            <Bone width={60} height={10} colour={bone} />
          </View>
        </View>
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Bone width="100%" height={420} round={0} colour="rgba(255,255,255,0.06)" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingHorizontal: sp[4], minHeight: 64 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp[3] },
  gridWide: { flexDirection: "row", flexWrap: "wrap", gap: sp[4] },
  cellWide: { flexGrow: 1, flexBasis: 320, minWidth: 0 },
  notice: { borderRadius: radius.xl, paddingHorizontal: sp[4], paddingVertical: sp[4], gap: sp[3] },
  author: { flexDirection: "row", alignItems: "center", gap: sp[3] },
  acts: { flexDirection: "row", alignItems: "center", gap: sp[8], paddingLeft: 2, minHeight: 32 },
  comment: { flexDirection: "row", alignItems: "flex-start", gap: sp[2] },
  bubble: { paddingHorizontal: sp[3], paddingVertical: sp[2] + 2, borderRadius: radius.md, gap: 6 },
  hero: { flexDirection: "row", alignItems: "center", gap: sp[3], borderRadius: radius.xl, padding: sp[4], overflow: "hidden" },
  inboxRow: { flexDirection: "row", alignItems: "flex-start", gap: sp[3], padding: sp[4] },
  groupHead: { flexDirection: "row", alignItems: "center", gap: sp[2], paddingHorizontal: sp[4], paddingVertical: sp[3], borderBottomWidth: StyleSheet.hairlineWidth },
  personRow: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[4], paddingVertical: sp[3] },
  friendList: { borderRadius: radius.md, overflow: "hidden" },
  friendRow: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingHorizontal: sp[3], paddingVertical: sp[3] },
  shift: { flexDirection: "row", alignItems: "center", gap: sp[3], paddingVertical: sp[3], paddingHorizontal: sp[3], minHeight: 66 },
  calRow: { flexDirection: "row", gap: 3, marginBottom: 3 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: sp[3], marginTop: sp[3], paddingTop: sp[3], borderTopWidth: StyleSheet.hairlineWidth },
  brk: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3], borderRadius: radius.md },
  month: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: sp[3], paddingHorizontal: sp[2], borderBottomWidth: StyleSheet.hairlineWidth },
  holiday: { flexDirection: "row", alignItems: "center", gap: sp[3], padding: sp[3] },
});
