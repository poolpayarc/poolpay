/**
 * Brand colours for the handful of places that need a real hex string
 * instead of a Tailwind class ,third-party themes (RainbowKit), canvas,
 * <meta> content, etc.
 *
 * These MUST stay in step with the `@theme` block in src/index.css, which
 * is the source of truth for everything styled with a class name.
 *
 * `navy` is not a guess: every fully-opaque pixel of the logo mark in
 * public/logo.webp decodes to exactly rgb(10, 24, 98).
 */
export const BRAND = {
  /** Exact logo navy ,wordmark, headings, dark accents, primary buttons. */
  navy: "#0a1862",
  /** Lighter navy tint for hover states (same hue + saturation, L 21% → 28%). */
  navyHover: "#0d2082",
  /** Secondary highlight only. Not a primary brand colour. */
  highlight: "#3e52f3",
  white: "#ffffff",
} as const;
