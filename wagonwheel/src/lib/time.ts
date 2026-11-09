/** "just now", "5 minutes ago", "3 hours ago", "2 days ago", then the date. */
export function timeAgo(ms: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} ${d === 1 ? "day" : "days"} ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
