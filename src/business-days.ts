/**
 * Brazilian bank calendar: weekends and national holidays, including the
 * movable ones banks close for (Carnaval, Sexta-feira Santa, Corpus Christi).
 * A bill paid on a day banks are closed is only debited on the next business day.
 */

/** Month-day of the fixed national holidays. */
const FIXED_HOLIDAYS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

/** Days from Easter Sunday of the movable bank holidays: Carnaval Monday and Tuesday, Good Friday, Corpus Christi. */
const EASTER_OFFSETS = [-48, -47, -2, 60];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Easter Sunday of `year` (Gregorian calendar, anonymous algorithm). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function isBusinessDay(date: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  if (weekday === 0 || weekday === 6) return false;
  if (FIXED_HOLIDAYS.includes(date.slice(5))) return false;
  const e = easter(y);
  return !EASTER_OFFSETS.some((off) => iso(new Date(y, e.getMonth(), e.getDate() + off)) === date);
}

/** `date` itself when banks open that day, else the next day they do. */
export function businessDayFrom(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  let out = date;
  for (let i = 1; !isBusinessDay(out); i++) out = iso(new Date(y, m - 1, d + i));
  return out;
}
