import { ArrowLeft, BookOpen, Clock, Laptop, Mail, Send, ShieldCheck, Smartphone, Tablet, Upload } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { EmptyState } from "../components/books/BookBrowser";
import { ProgressBar } from "../components/books/ProgressBar";
import { PageHeader } from "../components/ui/PageHeader";
import { getAccountOverview, type AccountOverview } from "../lib/admin";
import { shortDate } from "../lib/bookStats";
import { fileSize, percent, timeAgo } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { useApi } from "../lib/useApi";

const DAY_MS = 86_400_000;
/** Monday first, in the administrator's own time zone. */
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const weekday = (d: Date) => (d.getDay() + 6) % 7;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** "3 h 20 min", "45 min", "under a minute". */
export function duration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 1) return seconds > 0 ? "under a minute" : "0 min";
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** A browser or app, from its user agent: "Chrome on Windows", "Android app". */
export function deviceName(ua: string | null): { label: string; kind: "phone" | "tablet" | "computer" } {
  if (!ua) return { label: "Unknown device", kind: "computer" };
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const kind = os === "iPad" || (os === "Android" && !/Mobile/.test(ua)) ? "tablet" : os === "iPhone" || os === "Android" ? "phone" : "computer";
  // The Android app is a WebView ("; wv)").
  if (os === "Android" && /; wv\)/.test(ua)) return { label: "Android app", kind };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const label = browser && os ? `${browser} on ${os}` : (browser ?? os ?? ua.slice(0, 60));
  return { label, kind };
}

/**
 * How the account uses the app, in the administrator's time zone: a weekday × hour grid (how many
 * of the last 90 days it was used in that hour), the last 90 days one by one, and a summary.
 */
export function useRoutine(data: AccountOverview | null) {
  return useMemo(() => {
    if (!data) return null;
    const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const usedDays = new Set<string>();
    for (const iso of data.activityHours) {
      const d = new Date(iso);
      grid[weekday(d)]![d.getHours()]!++;
      usedDays.add(dayKey(d));
    }
    const readByDay = new Map<string, number>();
    let read90 = 0;
    for (const r of data.readingHours) {
      const k = dayKey(new Date(r.hour));
      readByDay.set(k, (readByDay.get(k) ?? 0) + r.seconds);
      usedDays.add(k);
      read90 += r.seconds;
    }
    const max = Math.max(0, ...grid.flat());

    // The busiest three-hour stretch and weekday, when there is enough to say so.
    const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((n, row) => n + row[h]!, 0));
    let bestStart = 0;
    let bestSum = -1;
    for (let h = 0; h < 24; h++) {
      const sum = byHour[h]! + byHour[(h + 1) % 24]! + byHour[(h + 2) % 24]!;
      if (sum > bestSum) [bestStart, bestSum] = [h, sum];
    }
    const byDay = grid.map((row) => row.reduce((a, b) => a + b, 0));
    const bestDay = byDay.indexOf(Math.max(...byDay));
    const hoursSeen = data.activityHours.length;

    // The last 13 weeks, Monday to Sunday, ending this week.
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today.getTime() - (weekday(today) + 12 * 7) * DAY_MS);
    const days = Array.from({ length: 13 * 7 }, (_, i) => {
      const d = new Date(start.getTime() + i * DAY_MS);
      const k = dayKey(d);
      return { date: d, future: d > today, used: usedDays.has(k), seconds: readByDay.get(k) ?? 0 };
    });
    const maxRead = Math.max(0, ...days.map((d) => d.seconds));

    return {
      grid,
      max,
      days,
      maxRead,
      activeDays: usedDays.size,
      read90,
      usualHours: hoursSeen >= 3 ? `${hourLabel(bestStart)}–${hourLabel((bestStart + 3) % 24)}` : null,
      busiestDay: hoursSeen >= 3 ? WEEKDAYS[bestDay]! : null,
    };
  }, [data]);
}

/** One of five steps of the accent, from "none" to "most". */
const STEPS = ["bg-elevated", "bg-accent/25", "bg-accent/45", "bg-accent/70", "bg-accent"];
const step = (value: number, max: number) => (value <= 0 || max <= 0 ? 0 : Math.min(4, 1 + Math.floor((value / max) * 3.999)));

function Legend({ low, high, extra }: { low: string; high: string; extra?: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {extra}
      <span className="flex items-center gap-1.5">
        {low}
        {STEPS.map((c) => (
          <span key={c} className={`h-3 w-3 rounded-[3px] ${c}`} />
        ))}
        {high}
      </span>
    </div>
  );
}

function WeekGrid({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px]" aria-label="Hours of use by weekday">
        <thead>
          <tr>
            <th />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col" className="w-3.5 text-[10px] font-normal text-muted sm:w-5">
                {h % 3 === 0 ? h : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <th scope="row" className="pr-2 text-left text-xs font-normal text-muted">
                {WEEKDAYS[d]!.slice(0, 3)}
              </th>
              {row.map((n, h) => (
                <td
                  key={h}
                  title={`${WEEKDAYS[d]}s, ${hourLabel(h)}–${hourLabel((h + 1) % 24)}: ${n ? `used on ${n} ${n === 1 ? "day" : "days"}` : "never"}`}
                  className={`h-3.5 w-3.5 rounded-[3px] sm:h-5 sm:w-5 ${STEPS[step(n, max)]}`}
                >
                  <span className="sr-only">{n}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayStrip({ days, maxRead }: { days: { date: Date; future: boolean; used: boolean; seconds: number }[]; maxRead: number }) {
  const weeks = Array.from({ length: days.length / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]" role="img" aria-label="The last 90 days: days the app was used and minutes read">
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {week.map((d) => {
              const label = d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
              const cls = d.future
                ? "bg-transparent"
                : d.seconds > 0
                  ? STEPS[step(d.seconds, maxRead)]
                  : d.used
                    ? "bg-elevated ring-1 ring-inset ring-accent/60"
                    : STEPS[0];
              return (
                <span
                  key={d.date.toISOString()}
                  title={d.future ? undefined : `${label}: ${d.seconds > 0 ? `read ${duration(d.seconds)}` : d.used ? "used the app, nothing read" : "not used"}`}
                  className={`h-3.5 w-3.5 rounded-[3px] sm:h-4 sm:w-4 ${cls}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="surface p-4 text-center">
      <div className="flex items-center justify-center gap-2 text-xl font-semibold tabular-nums">
        <span className="text-accent [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </div>
  );
}

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`surface p-5 ${className}`}>
      <h2 className="eyebrow mb-4">{title}</h2>
      {children}
    </section>
  );
}

const Badge = ({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "accent" | "danger" | "warn" }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
      { muted: "bg-elevated text-muted", accent: "bg-accent/12 text-accent", danger: "bg-rose-500/15 text-rose-300", warn: "bg-amber-400/15 text-amber-200" }[tone]
    }`}
  >
    {children}
  </span>
);

/** "/admin/users/:id" — one account: its routine, reading, books, devices and emails (administrators only). */
export function AdminAccountPage() {
  const { id = "" } = useParams();
  const { me } = useLibrary();
  const { data, error } = useApi(() => (me?.isAdmin ? getAccountOverview(id) : Promise.resolve(null)), [id], { reloadOn: [me?.isAdmin, id] });
  const routine = useRoutine(data ?? null);

  if (me && !me.isAdmin) {
    return (
      <EmptyState icon={<ShieldCheck />} title="Administrators only">
        This page is for the server’s administrators.
      </EmptyState>
    );
  }
  const back = (
    <Link to="/admin" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="h-4 w-4" /> Accounts
    </Link>
  );
  if (error) {
    return (
      <>
        {back}
        <p className="py-10 text-center text-sm text-muted">This account could not be found.</p>
      </>
    );
  }
  if (!data || !routine) {
    return (
      <>
        {back}
        <div className="h-96 animate-pulse rounded-2xl bg-elevated/50" />
      </>
    );
  }

  const a = data.account;
  const { sessions, appPasswords, readers } = data.devices;
  return (
    <>
      {back}
      <PageHeader
        title={a.name || a.email}
        subtitle={`${a.email} · joined ${shortDate(a.createdAt)} · ${a.lastSeenAt ? `last active ${timeAgo(a.lastSeenAt)}` : "no activity yet"}`}
        actions={
          <Link to={`/admin?tab=emails&to=${encodeURIComponent(a.id)}`} className="btn">
            <Send className="h-4 w-4" /> Send email
          </Link>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          {a.isAdmin && (
            <Badge tone="accent">
              <ShieldCheck className="h-3 w-3" /> Admin
            </Badge>
          )}
          {a.plan && <Badge tone="accent">{a.plan} plan</Badge>}
          {a.blocked && <Badge tone="danger">Blocked{a.blockedReason ? `: ${a.blockedReason}` : ""}</Badge>}
          {a.optedOut && <Badge tone="warn">Unsubscribed from promotional emails</Badge>}
          {!a.emailVerified && <Badge>Email not confirmed</Badge>}
          <Badge>
            {fileSize(a.usedBytes)} {a.quotaBytes === null ? "used" : `of ${fileSize(a.quotaBytes)}`}
          </Badge>
        </div>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Days active (90 days)" value={routine.activeDays} icon={<Clock />} />
        <Tile label="Read (90 days)" value={duration(routine.read90)} icon={<BookOpen />} />
        <Tile label="Books uploaded" value={data.books.uploads} icon={<Upload />} />
        <Tile label="Books finished" value={data.totals.finished} icon={<BookOpen />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="When they use BookRaven" className="lg:col-span-2">
          {data.activityHours.length === 0 && data.readingHours.length === 0 ? (
            <p className="text-sm text-muted">No use in the last 90 days.</p>
          ) : (
            <>
              <p className="mb-4 text-sm">
                {routine.usualHours ? (
                  <>
                    Mostly <strong>{routine.usualHours}</strong>, busiest on <strong>{routine.busiestDay}s</strong>.{" "}
                  </>
                ) : null}
                <span className="text-muted">Times are in your time zone; each square counts the days (of the last 90) with use in that hour.</span>
              </p>
              <div className="grid gap-8 xl:grid-cols-[auto_1fr]">
                <div>
                  <WeekGrid grid={routine.grid} max={routine.max} />
                  <Legend low="Never" high="Most days" />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-medium text-muted">Last 13 weeks, a column a week</h3>
                  <DayStrip days={routine.days} maxRead={routine.maxRead} />
                  <Legend
                    low="Read less"
                    high="more"
                    extra={
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded-[3px] bg-elevated ring-1 ring-inset ring-accent/60" /> Used, nothing read
                      </span>
                    }
                  />
                  <p className="mt-3 text-xs text-muted">
                    All time: {duration(data.totals.readingSeconds)} read over {data.totals.readingDays} {data.totals.readingDays === 1 ? "day" : "days"}.
                  </p>
                </div>
              </div>
            </>
          )}
        </Section>

        <Section title="Reading">
          {data.reading.length === 0 ? (
            <p className="text-sm text-muted">Hasn’t opened a book yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.reading.map((r) => (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{percent(r.percentage)}</span>
                  </div>
                  <ProgressBar value={r.percentage} className="my-1" />
                  <div className="truncate text-xs text-muted">
                    {r.author ? `${r.author} · ` : ""}
                    {timeAgo(r.updatedAt)}
                    {r.device ? ` · ${r.device}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Books">
          <p className="mb-3 text-sm">
            <strong>{data.books.uploads}</strong> uploaded · <strong>{data.books.added}</strong> added from share links or the Public Library
            {data.books.public ? (
              <>
                {" "}
                · <strong>{data.books.public}</strong> published
              </>
            ) : null}
          </p>
          {data.books.recent.length === 0 ? (
            <p className="text-sm text-muted">No books yet.</p>
          ) : (
            <ul className="divide-y divide-line/60 text-sm">
              {data.books.recent.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{b.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {b.added ? "Added" : "Uploaded"} {shortDate(b.createdAt)} · {b.format.toUpperCase()} · {fileSize(b.sizeBytes)}
                      {b.isPublic ? " · public" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Devices">
          {sessions.length + appPasswords.length + readers.length === 0 ? (
            <p className="text-sm text-muted">Not signed in anywhere.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {sessions.map((s, i) => {
                const d = deviceName(s.userAgent);
                const Icon = d.kind === "phone" ? Smartphone : d.kind === "tablet" ? Tablet : Laptop;
                return (
                  <li key={`s${i}`} className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 truncate">{d.label}</span>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(s.lastUsedAt)}</span>
                  </li>
                );
              })}
              {appPasswords.map((p, i) => (
                <li key={`p${i}`} className="flex items-center gap-2.5">
                  <Tablet className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">
                    {p.name} <span className="text-xs text-muted">(app password)</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{p.lastUsedAt ? timeAgo(p.lastUsedAt) : "never used"}</span>
                </li>
              ))}
              {readers.length > 0 && (
                <li className="pt-1 text-xs text-muted">Reads on: {readers.map((r) => `${r.name} (${timeAgo(r.lastUsedAt)})`).join(", ")}</li>
              )}
            </ul>
          )}
        </Section>

        <Section title="Emails received">
          {data.emails.length === 0 ? (
            <p className="text-sm text-muted">No promotional emails yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.emails.map((e, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="shrink-0 text-xs text-muted" title={new Date(e.sentAt).toLocaleString()}>
                    {timeAgo(e.sentAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
