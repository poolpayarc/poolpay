import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Coins,
  Droplets,
  Eye,
  FileCheck2,
  Fuel,
  HandCoins,
  KeyRound,
  Landmark,
  Minus,
  PiggyBank,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  Vote,
  Wallet,
} from "lucide-react";
import { POOLPAY_ADDRESS } from "../config/contracts";
import { Wordmark } from "../components/ui";
import { CountUp, Reveal, Stagger, StaggerItem } from "../components/motion";

const FAUCET_URL = "https://faucet.circle.com";
const ARCSCAN_URL = `https://testnet.arcscan.app/address/${POOLPAY_ADDRESS}`;

const EASE = [0.22, 1, 0.36, 1] as const;

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-navy font-semibold text-white shadow-sm transition-all duration-200 hover:bg-navy-hover hover:shadow-lg hover:shadow-navy/25 active:scale-[0.98]";
const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-hairline bg-white font-semibold text-ink transition-all duration-200 hover:border-hairline-strong hover:bg-surface active:scale-[0.98]";

const STEPS = [
  {
    icon: Users,
    title: "Create a Pool",
    desc: "Set your monthly contribution, choose a 6 or 12 month term, and invite 2–10 members by wallet address.",
  },
  {
    icon: PiggyBank,
    title: "Save Together",
    desc: "Everyone deposits their share each month. The dashboard tracks every deposit, transparently, onchain.",
  },
  {
    icon: Vote,
    title: "Borrow & Vote",
    desc: "Need funds? Request a loan from the pool. Your group votes to approve it before anything moves.",
  },
  {
    icon: FileCheck2,
    title: "Settle Up",
    desc: "At the end of the term every loan is repaid, interest is shared out, and everyone withdraws.",
  },
];

const WHY = [
  {
    icon: KeyRound,
    title: "Non-custodial by design",
    desc: "Funds sit in the smart contract, not with a company. No admin key can move them, freeze them, or lend them out. Your keys, your money.",
  },
  {
    icon: Eye,
    title: "Every rupee accounted for",
    desc: "Who deposited, who borrowed, who voted, what's owed ,all of it is onchain and verifiable on ArcScan. No spreadsheet, no trust required.",
  },
  {
    icon: Fuel,
    title: "Costs cents, not percent",
    desc: "Built on Arc, so a deposit costs about two cents in gas. No origination fees, no platform cut, no monthly subscription.",
  },
];

const STATS = [
  { to: 10, prefix: "", suffix: "", label: "Members per pool, up to", icon: Users },
  { to: 0.02, decimals: 2, prefix: "$", suffix: "", label: "Typical gas per transaction", icon: Fuel },
  { to: 2, prefix: "", suffix: "%", label: "Monthly interest, paid by borrowers", icon: HandCoins },
  { to: 100, prefix: "", suffix: "%", label: "Non-custodial. No admin controls.", icon: ShieldCheck },
];

const FAQ = [
  {
    q: "Do my savings earn interest just for sitting there?",
    a: "No. Deposits do not earn anything on their own. Interest only exists when a member actually borrows and repays ,that repaid interest is then shared among members based on their net positive balance. If nobody borrows, there is no interest to share, and there is no guaranteed return.",
  },
  {
    q: "So what is the 2%?",
    a: "It is what a borrower pays on the amount they borrow, per month. Borrow $400 for one month and you repay $408. Borrow $400 for three months and you repay $424. It is a fixed rate, the same for every pool, and it is shown on the invoice before anyone votes.",
  },
  {
    q: "What stops someone taking the money and leaving?",
    a: "A loan only moves after a majority of the other members vote to approve it, and the request expires on its own after 7 days if it doesn't get enough votes. You can also only leave a pool once you have no outstanding debt or pending requests.",
  },
  {
    q: "Who controls the pool?",
    a: "Nobody. Once a pool is created there are no special privileges ,not for the creator, not for us. Every rule lives in the contract, and closing the pool at the end of its term can be triggered by any member.",
  },
  {
    q: "Is this real money?",
    a: "PoolPay is live on Arc Testnet, so it uses test USDC you can claim free from the faucet. Nothing here is mainnet money yet ,try it with a group and see how it feels.",
  },
];

/* ------------------------------------------------------------------ *
 * The animated pool diagram in the hero.
 *
 * Every number here is decorative and hardcoded ,it reads no contract
 * and holds no wallet state. It exists to show the shape of the idea:
 * members around a shared pool, deposits flowing in, the occasional
 * loan flowing back out.
 *
 * Geometry is a plain SVG on a 420×420 viewBox so every coordinate is
 * exact. Coins animate `cx`/`cy` (attributes, not transforms), which
 * Framer handles natively and the compositor handles cheaply.
 *
 * Motion budget, deliberately calm: 3–3.6s travel, long gaps between
 * repeats, opacity peaking below 1, nothing rotating or bouncing.
 * ------------------------------------------------------------------ */
const CENTER = { x: 210, y: 206 };
const RING_R = 152;

/** 5 members, evenly spaced from the top. Navy tints, not distinct hues. */
const MEMBERS = [
  { initials: "AK", x: 210, y: 54, tint: 1 },
  { initials: "RS", x: 355, y: 160, tint: 0.82 },
  { initials: "MP", x: 299, y: 330, tint: 0.66 },
  { initials: "JD", x: 121, y: 330, tint: 0.82 },
  { initials: "SV", x: 65, y: 160, tint: 0.66 },
];

/** Deposits in from three members; one loan back out to another. */
const FLOWS = [
  { from: 0, dir: "in" as const, delay: 0, duration: 3.0, gap: 2.4 },
  { from: 2, dir: "in" as const, delay: 1.2, duration: 3.2, gap: 2.2 },
  { from: 4, dir: "in" as const, delay: 2.4, duration: 3.0, gap: 2.6 },
  // Loans are the exception, so this one waits a long time between runs.
  { from: 1, dir: "out" as const, delay: 4.2, duration: 3.6, gap: 7.5 },
];

function Coin({
  from,
  to,
  color,
  delay,
  duration,
  gap,
  reduced,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: string;
  delay: number;
  duration: number;
  gap: number;
  reduced: boolean;
}) {
  // Reduced motion: freeze the coin partway along its path so the diagram
  // still reads as "value moves between these points", with nothing moving.
  if (reduced) {
    return (
      <circle
        cx={from.x + (to.x - from.x) * 0.55}
        cy={from.y + (to.y - from.y) * 0.55}
        r={4.5}
        fill={color}
        opacity={0.4}
      />
    );
  }
  const travel = {
    cx: [from.x, to.x],
    cy: [from.y, to.y],
  };
  const timing = {
    duration,
    repeat: Infinity,
    repeatDelay: gap,
    delay,
    ease: "easeInOut" as const,
  };
  return (
    <>
      {/* soft trail ,a larger, much fainter twin on the same path */}
      <motion.circle
        r={10}
        fill={color}
        initial={{ cx: from.x, cy: from.y, opacity: 0 }}
        animate={{ ...travel, opacity: [0, 0.1, 0.1, 0] }}
        transition={timing}
      />
      <motion.circle
        r={4.5}
        fill={color}
        initial={{ cx: from.x, cy: from.y, opacity: 0 }}
        animate={{ ...travel, opacity: [0, 0.9, 0.9, 0] }}
        transition={timing}
      />
    </>
  );
}

function PoolVisual() {
  const reduced = useReducedMotion() ?? false;
  const balanceRef = useRef<SVGTextElement>(null);

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

  /**
   * The balance ticks 2,360 → 2,400 each time a deposit lands, so it reads as
   * money arriving without the number ever drifting away from its hardcoded
   * value. Written straight to the SVG text node ,a 0.9s count at 60fps
   * would otherwise be ~54 React renders every few seconds, forever.
   */
  useEffect(() => {
    const el = balanceRef.current;
    if (!el) return;
    if (reduced) {
      el.textContent = fmt(2400);
      return;
    }
    let stop: (() => void) | undefined;
    const tick = () => {
      const controls = animate(2360, 2400, {
        duration: 0.9,
        ease: EASE,
        onUpdate: (v) => {
          if (balanceRef.current) balanceRef.current.textContent = fmt(v);
        },
      });
      stop = () => controls.stop();
    };
    tick();
    const id = setInterval(tick, 3600);
    return () => {
      clearInterval(id);
      stop?.();
    };
  }, [reduced]);

  return (
    <div className="relative">
      {/* Faint navy glow behind the card. A real radial gradient rather than a
          blurred rounded rect ,the latter keeps its corners even under
          blur-3xl and reads as a visible box edge behind the card. */}
      <div
        className="pointer-events-none absolute -inset-16 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(closest-side circle at 50% 46%, color-mix(in srgb, var(--color-navy) 11%, transparent), transparent 100%)",
        }}
      />

      <div className="rounded-3xl border border-hairline bg-white p-6 shadow-xl shadow-navy/[0.08] sm:p-9">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Live pool
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <span className="relative flex h-1.5 w-1.5">
              {!reduced && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-navy/60" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-navy" />
            </span>
            5 members
          </span>
        </div>

        {/* No font utility here on purpose ,SVG text inherits Inter from
            body, and `font-sans` would swap in Tailwind's default stack. */}
        <svg
          viewBox="0 0 420 420"
          className="block h-auto w-full"
          role="img"
          aria-label="Diagram of five members contributing to a shared pool, with one loan paid back out"
        >
          {/* the circle the members sit on ,static, just structure */}
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={RING_R}
            fill="none"
            stroke="var(--color-navy)"
            strokeOpacity={0.09}
            strokeDasharray="3 7"
          />

          {/* spokes: member → pool. Drawn first so the pool card covers the
              inner ends without needing trimmed line maths. */}
          {MEMBERS.map((m) => (
            <line
              key={`spoke-${m.initials}`}
              x1={m.x}
              y1={m.y}
              x2={CENTER.x}
              y2={CENTER.y}
              stroke="var(--color-navy)"
              strokeOpacity={0.1}
              strokeWidth={1.5}
            />
          ))}

          {/* coins in flight */}
          {FLOWS.map((f) => {
            const member = MEMBERS[f.from];
            const inbound = f.dir === "in";
            return (
              <Coin
                key={`flow-${f.from}-${f.dir}`}
                from={inbound ? member : CENTER}
                to={inbound ? CENTER : member}
                color={inbound ? "var(--color-navy)" : "var(--color-highlight)"}
                delay={f.delay}
                duration={f.duration}
                gap={f.gap}
                reduced={reduced}
              />
            );
          })}

          {/* the pool itself */}
          <g>
            <rect
              x={CENTER.x - 79}
              y={CENTER.y - 53}
              width={158}
              height={106}
              rx={22}
              fill="#ffffff"
              stroke="var(--color-hairline)"
            />
            <rect
              x={CENTER.x - 79}
              y={CENTER.y - 53}
              width={158}
              height={106}
              rx={22}
              fill="var(--color-navy)"
              fillOpacity={0.04}
            />
            <motion.g
              animate={reduced ? undefined : { opacity: [0.9, 1, 0.9] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <text
                x={CENTER.x}
                y={CENTER.y - 22}
                textAnchor="middle"
                fill="var(--color-muted)"
                fontSize={10}
                fontWeight={600}
                letterSpacing={1.1}
              >
                POOL BALANCE
              </text>
              <text
                ref={balanceRef}
                x={CENTER.x}
                y={CENTER.y + 12}
                textAnchor="middle"
                fill="var(--color-navy)"
                fontSize={30}
                fontWeight={700}
                letterSpacing={-0.5}
              >
                {fmt(2400)}
              </text>
              <text
                x={CENTER.x}
                y={CENTER.y + 34}
                textAnchor="middle"
                fill="var(--color-muted)"
                fontSize={10}
                fontWeight={500}
              >
                USDC · Month 4 of 12
              </text>
            </motion.g>
          </g>

          {/* members */}
          {MEMBERS.map((m) => (
            <g key={m.initials}>
              <circle cx={m.x} cy={m.y} r={26} fill="#ffffff" />
              <circle
                cx={m.x}
                cy={m.y}
                r={22}
                fill="var(--color-navy)"
                fillOpacity={m.tint}
              />
              <text
                x={m.x}
                y={m.y + 4}
                textAnchor="middle"
                fill="#ffffff"
                fontSize={11}
                fontWeight={700}
                letterSpacing={0.3}
              >
                {m.initials}
              </text>
            </g>
          ))}
        </svg>

        {/* legend, so the two coin colours mean something */}
        <div className="mt-2 flex items-center justify-center gap-5 text-[11px] font-medium text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-navy" />
            Deposit in
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-highlight" />
            Loan out
          </span>
        </div>
      </div>
    </div>
  );
}

/** The 2% explainer: principal → term → repayment, with arrows between. */
function InterestFlow() {
  const cards = [
    { icon: Wallet, label: "You borrow", value: "$400", note: "from the pool's available balance" },
    { icon: Coins, label: "For", value: "3 months", note: "2% per month on what you borrowed" },
    { icon: Landmark, label: "You repay", value: "$424", note: "$400 principal + $24 interest" },
  ];
  return (
    <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
      {cards.map((c, i) => (
        <div key={c.label} className="flex flex-1 items-center gap-3">
          <Reveal delay={i * 0.12} className="flex-1">
            <div className="h-full rounded-2xl border border-hairline bg-white p-5 shadow-sm transition-shadow duration-300 hover:shadow-md">
              <c.icon className="h-5 w-5 text-navy/60" strokeWidth={2} aria-hidden="true" />
              <div className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">
                {c.label}
              </div>
              <div className="mt-1 text-2xl font-bold text-navy">{c.value}</div>
              <div className="mt-1.5 text-xs leading-relaxed text-muted">{c.note}</div>
            </div>
          </Reveal>
          {i < cards.length - 1 && (
            <Reveal
              delay={i * 0.12 + 0.2}
              y={0}
              duration={0.4}
              className="hidden shrink-0 text-navy/30 md:block"
            >
              <ArrowRight className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" />
            </Reveal>
          )}
        </div>
      ))}
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-hairline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:text-navy"
      >
        <span className="text-base font-semibold text-ink">{q}</span>
        <span className="shrink-0 text-navy/50">
          {open ? (
            <Minus className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
          )}
        </span>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="overflow-hidden"
      >
        <p className="pb-5 pr-10 text-sm leading-relaxed text-body">{a}</p>
      </motion.div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-ink">
      {/* ---------------- Header ---------------- */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-hairline bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" aria-label="PoolPay home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-4 sm:gap-7">
            <a
              href="#how"
              className="pp-underline hidden text-sm font-medium text-muted transition-colors hover:text-navy sm:block"
            >
              How it works
            </a>
            <a
              href="#faq"
              className="pp-underline hidden text-sm font-medium text-muted transition-colors hover:text-navy sm:block"
            >
              FAQ
            </a>
            <Link
              to="/docs"
              className="pp-underline hidden items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-navy sm:inline-flex"
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              Docs
            </Link>
            <Link to="/app" className={`${btnPrimary} px-5 py-2.5 text-sm`}>
              Launch App
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative overflow-hidden px-6 pb-24 pt-36 sm:pt-44">
        {/* Ambient backdrop: faded grid + two slow navy blooms. Pointer-events
            off so none of it can intercept a click on the CTAs. */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
          <div className="pp-grid absolute inset-0" />
          <div className="pp-drift absolute -top-32 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-navy/[0.07] blur-3xl" />
          <div className="pp-drift-rev absolute -top-10 right-[12%] h-72 w-72 rounded-full bg-highlight/[0.06] blur-3xl" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-white" />
        </div>

        {/* Split hero. Text first in the DOM so the stacked mobile order is
            copy → visual without needing order utilities. */}
        <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2 lg:gap-16">
          {/* ---- left: the pitch ---- */}
          <div className="min-w-0 text-left">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white/70 px-4 py-1.5 text-xs font-medium text-muted shadow-sm backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-navy" strokeWidth={2.2} aria-hidden="true" />
                Live on Arc Network Testnet
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
              className="mt-7 text-5xl font-bold leading-[1.05] tracking-tight text-navy lg:text-6xl"
            >
              Group savings &amp; lending, onchain.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.2, ease: EASE }}
              className="mt-6 max-w-xl text-lg leading-relaxed text-muted"
            >
              The mandali your family has run for generations, rebuilt as a smart contract. Save
              together every month, borrow from the pool when you need it, and let the group vote ,
              with every rupee visible to everyone.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.32, ease: EASE }}
              className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <Link to="/app" className={`${btnPrimary} w-full px-8 py-4 text-base sm:w-auto`}>
                Launch App
                <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
              </Link>
              <Link to="/docs" className={`${btnSecondary} w-full px-8 py-4 text-base sm:w-auto`}>
                <BookOpen className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                Read the docs
              </Link>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.44, ease: EASE }}
              className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-muted"
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-navy" strokeWidth={2.2} aria-hidden="true" />
                Non-custodial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Fuel className="h-3.5 w-3.5 text-navy" strokeWidth={2.2} aria-hidden="true" />
                ~$0.02 per transaction
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-navy" strokeWidth={2.2} aria-hidden="true" />
                2–10 members
              </span>
            </motion.p>
          </div>

          {/* ---- right: the living diagram ---- */}
          <motion.div
            className="min-w-0"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.28, ease: EASE }}
          >
            <PoolVisual />
          </motion.div>
        </div>
      </section>

      {/* ---------------- How it works ---------------- */}
      <section id="how" className="scroll-mt-24 border-t border-hairline bg-surface-alt py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy/60">
              How it works
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
              Four steps, start to finish
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted">
              The same rhythm as a traditional chit fund ,create, contribute, borrow, settle ,with
              the bookkeeping handled by a contract instead of a notebook.
            </p>
          </Reveal>

          <Stagger className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <StaggerItem key={s.title}>
                <motion.div
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="group h-full rounded-2xl border border-hairline bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-lg hover:shadow-navy/[0.07]"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy text-white shadow-sm">
                      <s.icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="font-mono text-2xl font-bold text-navy/10 transition-colors group-hover:text-navy/20">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-navy">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.desc}</p>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---------------- Why PoolPay ---------------- */}
      <section className="py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy/60">
              Why PoolPay
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
              Built so nobody has to be trusted
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted">
              Informal savings circles work until the record-keeping does. PoolPay removes the part
              that breaks.
            </p>
          </Reveal>

          <Stagger className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3" gap={0.1}>
            {WHY.map((w) => (
              <StaggerItem key={w.title}>
                <motion.div
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="h-full rounded-2xl border border-hairline bg-white p-7 shadow-sm transition-shadow duration-300 hover:shadow-lg hover:shadow-navy/[0.07]"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy/[0.06] text-navy">
                    <w.icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-navy">{w.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted">{w.desc}</p>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---------------- The 2% explainer ---------------- */}
      <section className="border-y border-hairline bg-surface-alt py-24 sm:py-28">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy/60">
              The 2%, plainly
            </span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
              Interest is what a borrower pays
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted">
              It is not a rate on your savings. Deposits earn nothing by themselves ,interest only
              exists once someone borrows and repays.
            </p>
          </Reveal>

          <div className="mt-14">
            <InterestFlow />
          </div>

          <Reveal delay={0.15}>
            <div className="mt-8 flex items-start gap-3 rounded-2xl border border-hairline bg-white p-5">
              <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-navy/50" strokeWidth={2} aria-hidden="true" />
              <p className="text-sm leading-relaxed text-body">
                <span className="font-semibold text-ink">Where that $24 goes:</span> back to the
                members, split by net positive balance ,so whoever had more saved in the pool
                receives a larger share. If nobody borrows, there is nothing to share out, and no
                return is promised to savers.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Stats band ---------------- */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-6">
          <Stagger className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4" gap={0.09}>
            {STATS.map((s) => (
              <StaggerItem key={s.label}>
                <div className="text-center">
                  <s.icon
                    className="mx-auto h-5 w-5 text-navy/40"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <div className="mt-3 text-4xl font-bold tracking-tight text-navy sm:text-5xl">
                    <CountUp
                      to={s.to}
                      decimals={s.decimals ?? 0}
                      prefix={s.prefix}
                      suffix={s.suffix}
                    />
                  </div>
                  <p className="mx-auto mt-2 max-w-[190px] text-sm leading-snug text-muted">
                    {s.label}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ---------------- FAQ ---------------- */}
      <section id="faq" className="scroll-mt-24 border-t border-hairline bg-surface-alt py-24 sm:py-28">
        <div className="mx-auto max-w-3xl px-6">
          <Reveal className="text-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-navy/60">FAQ</span>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-navy sm:text-4xl">
              Questions worth asking
            </h2>
          </Reveal>
          <Reveal delay={0.1} className="mt-10">
            <div className="rounded-2xl border border-hairline bg-white px-6 sm:px-8">
              {FAQ.map((f) => (
                <FaqRow key={f.q} q={f.q} a={f.a} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Final CTA ---------------- */}
      <section className="py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-navy px-8 py-16 text-center shadow-xl shadow-navy/20 sm:px-16">
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="pp-drift absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-white/[0.06] blur-3xl" />
                <div className="pp-drift-rev absolute -bottom-24 right-1/4 h-72 w-72 rounded-full bg-highlight/10 blur-3xl" />
              </div>
              <div className="relative">
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Start a pool with your circle
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/70">
                  PoolPay is live on Arc Testnet. Claim free test USDC, create a pool, and invite the
                  group ,it takes a couple of minutes.
                </p>
                <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link
                    to="/app"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-navy shadow-sm transition-all duration-200 hover:bg-white/90 hover:shadow-lg active:scale-[0.98] sm:w-auto"
                  >
                    Launch App
                    <ArrowRight className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                  </Link>
                  <a
                    href={FAUCET_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/25 px-8 py-4 text-base font-semibold text-white transition-all duration-200 hover:bg-white/10 active:scale-[0.98] sm:w-auto"
                  >
                    <Droplets className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
                    Claim testnet USDC
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="border-t border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2.5 text-sm text-muted">
              <Wordmark markCls="h-7 w-7" textCls="text-base" />
              <span>© 2026</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-sm text-muted">
              <Link to="/docs" className="pp-underline transition-colors hover:text-navy">
                Docs
              </Link>
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="pp-underline transition-colors hover:text-navy"
              >
                Faucet
              </a>
              <a
                href={ARCSCAN_URL}
                target="_blank"
                rel="noreferrer"
                className="pp-underline transition-colors hover:text-navy"
              >
                ArcScan
              </a>
              <Link to="/app" className="pp-underline transition-colors hover:text-navy">
                Launch App
              </Link>
            </div>
          </div>
          <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-hairline pt-6 text-xs text-faint sm:flex-row">
            <span>Built on Arc Network · Non-custodial · Open source</span>
            <span>Testnet only ,not real funds.</span>
            <span><a href="https://x.com/Kriyeto" target="_blank" rel="noopener noreferrer" className="hover:text-[#3e52f3] transition">Built by @Kriyeto</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
