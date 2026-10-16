import { useEffect } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { timesheet, type ShiftInput } from "@/api";
import { ApiError } from "@/api/client";
import { readPrivate, writePrivate, usePrivateScope, usePrivateState } from "@/storage/private";

export type PendingShift = { id: string; input: ShiftInput; created: string; error?: string; review?: boolean };
const KEY = "pending-shifts";
const locks = new Map<string, Promise<unknown>>();
async function change(scope: string, update: (rows: PendingShift[]) => PendingShift[]) {
  const task = (locks.get(scope) || Promise.resolve()).catch(() => {}).then(async () => {
    const next = update(await readPrivate<PendingShift[]>(scope, KEY, []));
    await writePrivate(scope, KEY, next);
  });
  locks.set(scope, task);
  try { await task; } finally { if (locks.get(scope) === task) locks.delete(scope); }
}
export function queueShift(scope: string, input: ShiftInput) {
  if (!input.client_id) throw new Error("This draft has no submission identifier.");
  return change(scope, rows => rows.some(row => row.id === input.client_id) ? rows : [...rows, {
    id: input.client_id!, input, created: new Date().toISOString(),
  }]);
}
export const removePending = (scope: string, id: string) => change(scope, rows => rows.filter(row => row.id !== id));
export const retryPending = (scope: string, id: string) => change(scope, rows => rows.map(row => row.id === id ? { ...row, review: false, error: undefined } : row));
const syncing = new Set<string>();
export async function syncShifts(scope: string, isCurrent: () => boolean) {
  if (syncing.has(scope)) return;
  syncing.add(scope);
  try {
    for (const row of await readPrivate<PendingShift[]>(scope, KEY, [])) {
      if (!isCurrent()) return;
      if (row.review) continue;
      try {
        await timesheet.addShift(row.input);
        await removePending(scope, row.id);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status === 0 || error.status === 401 || error.status >= 500) return;
        await change(scope, rows => rows.map(item => item.id === row.id ? { ...item, review: true, error: error.message } : item));
      }
    }
  } finally { syncing.delete(scope); }
}
export const usePendingShifts = () => usePrivateState<PendingShift[]>(KEY, []);
export function OfflineSync() {
  const scope = usePrivateScope();
  const [rows, , ready] = usePendingShifts();
  const client = useQueryClient();
  const pending = rows.filter(row => !row.review).map(row => row.id).join(",");
  useEffect(() => {
    if (!scope || !ready || !pending) return;
    let active = true;
    const run = () => syncShifts(scope, () => active).then(() => {
      if (active) for (const key of ["timesheet", "calendar", "clock", "pay", "home"]) void client.invalidateQueries({ queryKey: [key] });
    }).catch(() => {});
    void run();
    const timer = setInterval(() => { if (AppState.currentState === "active") void run(); }, 30_000);
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void run(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [scope, ready, pending, client]);
  return null;
}
