/** "Today" in Nepal (Asia/Kathmandu, UTC+5:45) as YYYY-MM-DD — independent of the server's timezone. */
export function todayInNepal(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
