import type { CSSProperties } from "react";

/** Inline style that staggers a `[data-reveal]` element's entrance. */
export function revealDelay(ms: number): CSSProperties {
  return { "--reveal-delay": `${ms}ms` } as CSSProperties;
}
