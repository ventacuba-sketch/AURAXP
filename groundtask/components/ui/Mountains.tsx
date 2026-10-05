/**
 * Decorative mountain ridgelines (static SVG, no images, no animation).
 * Ridges are generated deterministically at build time from a fixed seed, so
 * server and client output are identical.
 */

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Midpoint-displacement ridge shaped by a bell envelope around `peakX`. */
function ridge(seed: number, width: number, baseY: number, amplitude: number, peakX: number, roughness = 0.55) {
  const rand = seeded(seed);
  const levels = 7;
  const n = 2 ** levels;
  const noise = new Array<number>(n + 1).fill(0);
  let step = n;
  let scale = 1;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) {
      noise[i] = ((noise[i - half] ?? 0) + (noise[i + half] ?? 0)) / 2 + (rand() - 0.5) * scale;
    }
    step = half;
    scale *= roughness;
  }
  const points = noise.map((v, i): [number, number] => {
    const x = (i / n) * width;
    const d = (x - peakX) / width;
    const envelope = Math.exp(-d * d * 6);
    return [x, baseY - amplitude * envelope * (0.75 + v * 0.6) - amplitude * 0.12 * v];
  });
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${width} 400 L0 400 Z` };
}

const W = 1200;
const back = ridge(7, W, 310, 210, 880, 0.58);
const mid = ridge(19, W, 340, 150, 1080, 0.6);
const front = ridge(41, W, 375, 90, 640, 0.62);

type MountainsProps = {
  /** Unique prefix for gradient ids (several instances can share a page). */
  id: string;
  className?: string;
  /** Strength of the copper rim light. */
  glow?: "soft" | "warm";
};

export function Mountains({ id, className = "", glow = "soft" }: MountainsProps) {
  const ref = (name: string) => `${id}-${name}`;
  const rim = glow === "warm" ? 0.75 : 0.45;
  return (
    <svg
      viewBox={`0 0 ${W} 400`}
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
      focusable="false"
      className={`pointer-events-none ${className}`}
    >
      <defs>
        <linearGradient id={ref("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2994a" stopOpacity="0" />
          <stop offset="1" stopColor="#f2994a" stopOpacity={glow === "warm" ? 0.22 : 0.1} />
        </linearGradient>
        <linearGradient id={ref("back")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3634" />
          <stop offset="1" stopColor="#0b1620" />
        </linearGradient>
        <linearGradient id={ref("mid")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#222a32" />
          <stop offset="1" stopColor="#09121a" />
        </linearGradient>
        <linearGradient id={ref("front")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#111a22" />
          <stop offset="1" stopColor="#070e15" />
        </linearGradient>
        <linearGradient id={ref("rim")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f2994a" stopOpacity="0" />
          <stop offset="0.6" stopColor="#f2994a" stopOpacity={rim} />
          <stop offset="1" stopColor="#f6b57a" stopOpacity={rim * 0.8} />
        </linearGradient>
      </defs>
      <rect x="0" y="120" width={W} height="280" fill={`url(#${ref("sky")})`} />
      <path d={back.area} fill={`url(#${ref("back")})`} />
      <path d={back.line} fill="none" stroke={`url(#${ref("rim")})`} strokeWidth="1.2" />
      <path d={mid.area} fill={`url(#${ref("mid")})`} />
      <path d={mid.line} fill="none" stroke={`url(#${ref("rim")})`} strokeWidth="0.9" strokeOpacity="0.7" />
      <path d={front.area} fill={`url(#${ref("front")})`} />
    </svg>
  );
}
