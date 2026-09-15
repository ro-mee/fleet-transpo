export const manilaDate = (value = new Date()) => new Date(+new Date(value) + 8 * 3600_000).toISOString().slice(0, 10);

export function dispatchPlanWindow(date, now = new Date()) {
  const today = manilaDate(now);
  const day = date ?? today;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day)
    throw new Error('Choose a valid analysis date (YYYY-MM-DD).');
  const start = new Date(day + 'T00:00:00+08:00');
  return { date:day, start:start.toISOString(), end:new Date(+start + 86400_000).toISOString(), timezone:'Asia/Manila', includesOverdue:day === today };
}
