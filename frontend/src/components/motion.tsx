import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";

/* ------------------------------------------------------------------ *
 * Shared motion primitives.
 *
 * THE BUG THESE EXIST TO PREVENT
 * The first version gated every entrance purely on `whileInView` with
 * `viewport={{ once: true, margin: "-60px" }}`. When that observer didn't
 * fire, content stayed at `opacity: 0` forever ,present in the DOM,
 * selectable, copyable, and completely invisible. Measured on the landing
 * page: 30 of 36 animated blocks were invisible on first load, including
 * all four "How it works" cards and all three "Why PoolPay" cards.
 *
 * So visibility is now never a function of a single trigger. `useRevealed`
 * flips to visible on whichever of three independent paths happens first,
 * and one of them is a plain timer that cannot fail. Animation is an
 * enhancement on top of content that is going to appear regardless.
 *
 * House rules otherwise unchanged: entrances run once, 0.3–0.6s, soft
 * ease-out, ≤20px of travel, transform + opacity only.
 * ------------------------------------------------------------------ */

/** Soft ease-out. Same curve as the CSS transitions in index.css. */
const EASE = [0.22, 1, 0.36, 1] as const;
const DURATION = 0.5;

/**
 * Hard ceiling on how long anything may stay invisible waiting for a
 * scroll trigger. Short enough that a failed observer is never noticed,
 * long enough that the normal in-view path still wins for below-fold
 * content the user hasn't reached yet.
 */
const FALLBACK_MS = 600;

/**
 * True once the element should be visible. Set by whichever comes first:
 *   1. IntersectionObserver reports it in view ,the intended path
 *   2. FALLBACK_MS elapses ,the guarantee, immune to observer problems
 *   3. the user prefers reduced motion ,visible immediately, no animation
 *
 * `amount: 0.1` and no negative margin, so the observer fires as soon as a
 * sliver of the element is on screen rather than needing it 60px inside.
 */
function useRevealed(ref: RefObject<Element | null>) {
  const inView = useInView(ref, { once: true, amount: 0.1 });
  const reduced = useReducedMotion() ?? false;
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setElapsed(true), FALLBACK_MS);
    return () => clearTimeout(t);
  }, []);

  return { shown: reduced || inView || elapsed, reduced };
}

/** Fade-and-rise, with visibility guaranteed by `useRevealed`. */
export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 18,
  duration = DURATION,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { shown, reduced } = useRevealed(ref);
  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={reduced ? { duration: 0 } : { duration, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

type StaggerState = { shown: boolean; gap: number; delay: number; reduced: boolean };

/**
 * Defaults to `shown: true` on purpose: a <StaggerItem> rendered outside a
 * <Stagger> is visible rather than invisible. Failure mode of last resort
 * should always be "you can see it".
 */
const StaggerCtx = createContext<StaggerState>({
  shown: true,
  gap: 0.08,
  delay: 0,
  reduced: false,
});

/**
 * Parent for a card grid. Children should be <StaggerItem>.
 *
 * Each item animates *itself* off a shared flag and its own index, rather
 * than relying on Framer's parent→child variant propagation. One less
 * mechanism between the content and being on screen ,and propagation was a
 * prime suspect in the original invisible-cards bug.
 */
export function Stagger({
  children,
  className = "",
  gap = 0.08,
  delay = 0.05,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { shown, reduced } = useRevealed(ref);

  // Hand each StaggerItem its position so it can offset its own delay.
  // Only StaggerItems are touched, so nothing else gets a stray `index`
  // attribute leaking onto a DOM node.
  let i = 0;
  const indexed = Children.map(children, (child) => {
    if (isValidElement(child) && child.type === StaggerItem) {
      return cloneElement(child as ReactElement<{ index?: number }>, { index: i++ });
    }
    return child;
  });

  return (
    <StaggerCtx.Provider value={{ shown, gap, delay, reduced }}>
      <div ref={ref} className={className}>
        {indexed}
      </div>
    </StaggerCtx.Provider>
  );
}

export function StaggerItem({
  children,
  className = "",
  index = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Injected by <Stagger>; only set it by hand outside one. */
  index?: number;
}) {
  const { shown, gap, delay, reduced } = useContext(StaggerCtx);
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
      transition={
        reduced ? { duration: 0 } : { duration: DURATION, delay: delay + index * gap, ease: EASE }
      }
    >
      {children}
    </motion.div>
  );
}

/**
 * Hover lift for cards. Kept as a component so the values stay in one
 * place; `-3px` and a slightly stronger shadow is enough to feel responsive
 * without the card detaching from the page.
 */
export function HoverLift({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Counts up to `to` the first time it becomes visible.
 *
 * Uses the same guaranteed trigger as everything else ,the previous version
 * waited on `whileInView` and would sit displaying "0" indefinitely if that
 * never fired, which is the same bug wearing different clothes: a stat that
 * silently reads zero is worse than one that never animates.
 *
 * Writes to the DOM node directly rather than through state: a 1.1s count at
 * 60fps is ~66 renders per stat, which would re-render the whole stats band
 * four times over for no visual gain.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1.1,
  className = "",
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { shown, reduced } = useRevealed(ref);

  const format = (n: number) =>
    `${prefix}${n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || !shown) return;
    if (reduced) {
      el.textContent = format(to);
      return;
    }
    const controls = animate(0, to, {
      duration,
      ease: EASE,
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v);
      },
      // Belt and braces: whatever happens to the tween, the final value lands.
      onComplete: () => {
        if (ref.current) ref.current.textContent = format(to);
      },
    });
    return () => controls.stop();
    // `format` is derived from the primitives already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, to, reduced, duration, decimals, prefix, suffix]);

  return (
    <span ref={ref} className={className}>
      {format(0)}
    </span>
  );
}

/**
 * Fades content in on mount. Used on the app pages so data replacing a
 * skeleton doesn't snap into place.
 *
 * Safe by construction: `animate` runs on the first commit, so there is no
 * observer to miss and no way to get stuck hidden.
 */
export function FadeIn({
  children,
  className = "",
  duration = 0.35,
}: {
  children: ReactNode;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { duration, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
