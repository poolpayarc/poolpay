import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Inbox, type LucideIcon } from "lucide-react";
import { NOT_APPLICABLE } from "../lib/format";

/* ------------------------------------------------------------------ *
 * PoolPay design system ,shared primitives for the marketing pages and
 * every /app/* page. Light theme throughout: page `white` · cards
 * `surface` · borders `hairline` · brand `navy`.
 *
 * Every colour here is a token from the `@theme` block in src/index.css.
 * Don't reintroduce `[#rawhex]` classes.
 * ------------------------------------------------------------------ */

/* ---- brand ---- */

/**
 * The logo lockup: mark + "PoolPay" wordmark. Used in the header of every
 * page (marketing, docs, app) and in the footers.
 *
 * It points at `logo-mark.webp`, not `logo.webp`: the supplied artwork
 * frames the mark inside a large transparent margin ,the mark is only 34%
 * of the canvas height ,so rendering logo.webp at 32px would draw an 11px
 * mark floating in whitespace. `logo-mark.webp` is that same artwork
 * cropped square to the mark and flattened to exactly one colour, the
 * brand navy. logo.webp is kept intact for og:image, where the padding
 * is welcome.
 *
 * The <img> is `aria-hidden` with an empty alt because the wordmark text
 * sits right beside it ,the enclosing link already reads as "PoolPay",
 * and a described image would announce the name twice.
 */
export function Wordmark({
  markCls = "h-8 w-8",
  textCls = "text-xl",
  className = "",
}: {
  markCls?: string;
  textCls?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <img
        src="/logo-mark.webp"
        alt=""
        aria-hidden="true"
        width={353}
        height={353}
        className={`shrink-0 ${markCls}`}
      />
      <span className={`font-bold tracking-tight text-navy ${textCls}`}>PoolPay</span>
    </span>
  );
}

/* ---- layout / surface tokens ---- */
export const PAGE = "mx-auto max-w-5xl px-6 py-12";
export const CARD_BASE = "rounded-2xl border border-hairline bg-surface";
export const CARD = `${CARD_BASE} p-8`;

/* ---- form tokens ---- */
export const labelCls = "mb-2 block text-sm font-medium text-ink";
export const inputCls =
  "w-full rounded-xl border border-hairline bg-white px-4 py-3 text-ink outline-none transition-colors placeholder:text-faint focus:border-navy focus:ring-1 focus:ring-navy disabled:cursor-not-allowed disabled:opacity-60";
export const helpCls = "mt-1.5 text-xs text-muted";
/** Inline field-level validation message. */
export const errCls = "mt-1.5 text-xs font-medium text-danger-strong";

/* ---- buttons ---- */
// `active:scale` gives the press its weight. It's a CSS transition, so the
// reduced-motion block in index.css neutralises it automatically.
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
const BTN_VARIANT = {
  primary: "bg-navy text-white shadow-sm hover:bg-navy-hover hover:shadow-md hover:shadow-navy/20",
  secondary: "border border-hairline bg-white text-ink hover:border-hairline-strong hover:bg-surface",
  danger: "bg-danger text-white shadow-sm hover:bg-danger-strong hover:shadow-md hover:shadow-danger/20",
} as const;
const BTN_SIZE = { md: "px-6 py-3", sm: "px-4 py-2 text-sm" } as const;

/** Ready-made classes for links that should look like buttons. */
export const btnPrimary = `${BTN_BASE} ${BTN_VARIANT.primary} ${BTN_SIZE.md}`;
export const btnSecondary = `${BTN_BASE} ${BTN_VARIANT.secondary} ${BTN_SIZE.md}`;
export const btnPrimarySm = `${BTN_BASE} ${BTN_VARIANT.primary} ${BTN_SIZE.sm}`;
export const btnSecondarySm = `${BTN_BASE} ${BTN_VARIANT.secondary} ${BTN_SIZE.sm}`;

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  full = false,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}: {
  variant?: keyof typeof BTN_VARIANT;
  size?: keyof typeof BTN_SIZE;
  loading?: boolean;
  full?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${CARD} ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  right,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  back?: { to: string; label?: string };
}) {
  return (
    <div className="mb-10">
      {back && (
        <Link
          to={back.to}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
        >
          <span aria-hidden="true">←</span> {back.label ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-navy">{title}</h1>
          {subtitle && <p className="mt-2 text-base text-muted">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
    </div>
  );
}

/**
 * Section header for the app pages. `icon` is strongly encouraged ,a bare
 * heading over a card grid reads as unfinished, and the icon gives the eye
 * an anchor when scanning a long dashboard.
 */
export function SectionHeading({
  children,
  right,
  icon: Icon,
}: {
  children: ReactNode;
  right?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
      <h2 className="flex items-center gap-2.5 text-lg font-semibold text-navy">
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-navy/[0.07] text-navy">
            <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
          </span>
        )}
        {children}
      </h2>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  accent,
  danger,
  icon: Icon,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
  danger?: boolean;
  icon?: LucideIcon;
  /** Staggers a row of stat cards without needing a Stagger parent. */
  delay?: number;
}) {
  return (
    <motion.div
      className={`${CARD_BASE} p-5 transition-colors hover:border-hairline-strong`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
        {Icon && (
          <Icon
            className={`h-4 w-4 shrink-0 ${danger ? "text-danger-strong/70" : "text-navy/40"}`}
            strokeWidth={2.2}
            aria-hidden="true"
          />
        )}
      </div>
      <div
        className={`mt-1.5 text-2xl font-bold ${
          danger ? "text-danger-strong" : accent ? "text-navy" : "text-ink"
        }`}
      >
        {value}
      </div>
    </motion.div>
  );
}

export type BadgeKind = "pending" | "active" | "success" | "rejected" | "neutral";
/**
 * `success` is brand navy (it used to be green, which matched nothing in the
 * logo) and `active` uses the secondary highlight ,the two states show up
 * side by side in pool lists, so they must not collapse into the same chip.
 * `pending` and `rejected` stay amber/red: those are functional, not brand.
 */
const BADGE: Record<BadgeKind, string> = {
  pending: "bg-warn/10 text-warn-strong",
  active: "bg-highlight/10 text-highlight",
  success: "bg-navy/10 text-navy",
  rejected: "bg-danger/10 text-danger-deep",
  neutral: "bg-ink/5 text-muted",
};
export function StatusBadge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${BADGE[kind]}`}
    >
      {children}
    </span>
  );
}

/**
 * Centred icon + line + action. `hint` fills the space under the title so an
 * empty state explains itself instead of just stating the absence.
 */
export function EmptyState({
  title,
  action,
  icon: Icon = Inbox,
  hint,
}: {
  title: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
}) {
  return (
    <motion.div
      className={`${CARD_BASE} flex flex-col items-center px-6 py-16 text-center`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-white text-navy/50 shadow-sm">
        <Icon className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {hint && <p className="mt-2 max-w-sm text-sm text-muted">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

/**
 * Blocking confirmation for actions that move funds or can't be undone
 * (leaving a pool, closing a pool). The body should spell out the consequence,
 * not just ask "are you sure?".
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
  busy = false,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`${CARD} w-full max-w-sm`} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-navy">{title}</h3>
        <div className="mt-2 text-sm text-muted">{body}</div>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" full disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} full loading={busy} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger-deep">
      {children}
    </div>
  );
}

/**
 * Shown when a contract read fails. Every /app page uses this instead of
 * silently falling through to an empty state ,a failed read and "you have
 * nothing here" are very different things, and only one of them is fixable
 * by pressing Retry.
 */
export function LoadError({
  title,
  msg,
  onRetry,
  retrying,
  back = { to: "/app", label: "Back to pools" },
}: {
  title: string;
  msg?: string;
  onRetry?: () => void;
  retrying?: boolean;
  back?: { to: string; label: string } | null;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-danger/40 bg-danger/[0.06] px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-danger/30 bg-white text-danger-strong shadow-sm">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.9} aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted">
        {msg || "The Arc RPC didn't answer. It may be rate-limiting ,try again in a moment."}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <Button loading={retrying} onClick={onRetry}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
        {back && (
          <Link to={back.to} className={btnSecondary}>
            {back.label}
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Loading placeholder with a travelling shimmer rather than a flat pulse ,a
 * moving highlight reads as "fetching", a static grey block reads as broken.
 * The shimmer is CSS (see `.pp-shimmer`) so it costs nothing on the main
 * thread and switches off under prefers-reduced-motion.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pp-shimmer relative overflow-hidden rounded-xl bg-hairline/70 ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * Shimmer sized like a single figure, for one value that is still in flight
 * while the rest of its card is already on screen. Sits inline, so it can
 * stand in for a number inside a sentence or a table cell without the layout
 * jumping when the real value lands.
 */
export function ValueSkeleton({ className = "h-5 w-20" }: { className?: string }) {
  return <Skeleton className={`inline-block align-middle ${className}`} />;
}

/**
 * A figure the contract didn't give us. Never a dash and never "$0.00" ,a
 * failed read is not a zero balance, and a lone dash reads as an unfinished
 * screen instead of as something the Refresh button can fix.
 *
 * Deliberately warn-coloured and worded: wherever this shows up there is a
 * Retry or Refresh within reach (FreshnessBar, StaleBanner, LoadError).
 */
export function Unavailable({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 align-middle text-base font-semibold text-warn-strong ${className}`}
      title="This value couldn't be read from the contract. Refresh to try again."
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} aria-hidden="true" />
      Unavailable
    </span>
  );
}

/**
 * A quantity that genuinely does not exist for this row ,a member who has
 * already left has no payout coming, and "$0.00" would read as "their money is
 * gone" rather than "this doesn't apply".
 *
 * The dash is intentional here, which is exactly why it never appears alone:
 * it always carries a word and a tooltip, so it can't be mistaken for a value
 * that failed to load.
 */
export function NotApplicable({
  label,
  title,
  className = "",
}: {
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-muted ${className}`} title={title}>
      <span aria-hidden="true">{NOT_APPLICABLE}</span>
      <span className="text-xs font-normal">{label}</span>
    </span>
  );
}

/** Skeleton shaped like a card, for grids that load as a block. */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`${CARD_BASE} space-y-3 p-6 ${className}`}>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-3 w-1/4" />
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}
