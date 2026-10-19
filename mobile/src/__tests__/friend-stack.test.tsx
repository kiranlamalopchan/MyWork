import React from "react";
import { render } from "@testing-library/react-native";
import { FriendStack } from "@/ui/FriendStack";
import type { HomeFriends, Person } from "@/api";

jest.mock("expo-image", () => ({ Image: () => null }));

const person = (username: string): Person => ({ username, name: username, initial: username[0].toUpperCase(), hue: 120, photo: null, is_live: false, is_me: false, is_admin: false });

test("friends show as overlapping faces only — no count, no names line, not a button", async () => {
  const friends: HomeFriends = { total: 8, more: 2, summary: "Sam, Alex and 6 others", people: ["sam", "alex", "jo", "kim", "lee", "max"].map(person) };
  const s = await render(<FriendStack friends={friends} />);
  // One spoken label for the row; the faces inside are its picture.
  expect(s.getByLabelText("Your friends: Sam, Alex and 6 others")).toBeTruthy();
  for (const p of friends.people) expect(s.getByText(p.initial, { includeHiddenElements: true })).toBeTruthy();
  expect(s.queryByText("+2", { includeHiddenElements: true })).toBeNull();
  expect(s.queryByText(/friends/, { includeHiddenElements: true })).toBeNull();
  expect(s.queryByRole("button")).toBeNull();
});

test("a friend who is here now wears the live dot; the others don't", async () => {
  const friends: HomeFriends = { total: 2, more: 0, summary: "sam and alex", people: [{ ...person("sam"), is_live: true }, person("alex")] };
  const s = await render(<FriendStack friends={friends} />);
  expect(s.getAllByTestId("live-dot", { includeHiddenElements: true })).toHaveLength(1);
});

test("with nobody to show there is nothing at all", async () => {
  const s = await render(<FriendStack friends={{ total: 0, more: 0, summary: "", people: [] }} />);
  expect(s.toJSON()).toBeNull();
});
