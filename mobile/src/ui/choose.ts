/**
 * The pure part of Select's iOS action sheet.
 *
 * Here rather than in Select.tsx so it can be tested: the sheet itself is
 * native and only appears on a device, but what it is handed and what an
 * index coming back means are ordinary values, and getting either wrong
 * silently picks the wrong thing.
 */
export type Option = { value: string; label: string };

/**
 * The rows the sheet shows, with a tick on the one you are already on.
 *
 * An action sheet has no notion of a current row, so the tick is ours.
 * Cancel is last because that is where iOS expects it — and because
 * `cancelButtonIndex` is the length of the list, which is what makes any
 * index below it an answer.
 */
export function sheetRows(options: Option[], value: string): string[] {
  return [...options.map((o) => (o.value === value ? `✓ ${o.label}` : o.label)), "Cancel"];
}

/** The value behind an index the sheet reports, or null for Cancel. */
export function rowValue(options: Option[], index: number): string | null {
  return index >= 0 && index < options.length ? options[index].value : null;
}
