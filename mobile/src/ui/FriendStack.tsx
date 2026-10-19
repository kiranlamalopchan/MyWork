/**
 * Your friends as overlapping circles, just above the notice board — the
 * people "Friends only" posts reach. Just the faces: no count, no names line,
 * and only shown, not a control. Each face is ringed in the page's own colour
 * so one reads as sitting on the next. The site draws the same row
 * (templates/accounts/_friend_stack.html) from the same figures
 * (Friendship.faces_for). Nothing at all with nobody to show.
 */
import React from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import type { HomeFriends } from "@/api";

import { Avatar } from "./Avatar";
import { useTheme } from "./theme";

const RING = 3;

export function FriendStack({ friends }: { friends: HomeFriends }) {
  const t = useTheme();
  const narrow = useWindowDimensions().width < 480;
  if (!friends.total) return null;
  const FACE = narrow ? 40 : 46, OVERLAP = narrow ? 11 : 12;
  const disc = { width: FACE + RING * 2, height: FACE + RING * 2, borderRadius: (FACE + RING * 2) / 2, borderColor: t.bg, backgroundColor: t.bg };
  const people = friends.people;
  return (
    <View style={styles.row} accessible accessibilityRole="image" accessibilityLabel={`Your friends: ${friends.summary}`} testID="friend-stack">
      {people.map((person, i) => (
        <View key={person.username} style={[styles.face, disc, { marginLeft: i ? -OVERLAP : 0, zIndex: people.length - i }]}>
          <Avatar person={person} size={FACE} dotRing={t.bg} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4 },
  // Not clipped: the live dot hangs half outside the face, as on the site.
  face: { borderWidth: RING, alignItems: "center", justifyContent: "center" },
});
