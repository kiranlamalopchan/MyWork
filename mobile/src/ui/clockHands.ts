/** Local wall time, including the fractions that make real clock hands align. */
export function clockHands(timestamp: number) {
  const date = new Date(timestamp);
  const second = date.getSeconds();
  const minute = date.getMinutes() + second / 60;
  return { hour: (date.getHours() % 12 + minute / 60) * 30, minute: minute * 6, second: second * 6 };
}
