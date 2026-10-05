/** Minimal wireframe globe with a marker on central Chile. Decorative only. */
export function Globe({ className = "" }: { className?: string }) {
  const meridians = [-60, -30, 0, 30, 60];
  const parallels = [-50, -25, 0, 25, 50];
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <radialGradient id="globe-fill" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#1e2a36" />
          <stop offset="1" stopColor="#070e15" />
        </radialGradient>
        <linearGradient id="globe-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#94a3b8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#f2994a" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="90" fill="url(#globe-fill)" stroke="url(#globe-rim)" strokeWidth="1" />
      <g fill="none" stroke="#94a3b8" strokeOpacity="0.16" strokeWidth="0.6">
        {meridians.map((deg) => (
          <ellipse key={deg} cx="100" cy="100" rx={Math.abs(Math.sin((deg * Math.PI) / 180)) * 90 || 0.5} ry="90" />
        ))}
        {parallels.map((deg) => {
          const y = 100 + Math.sin((deg * Math.PI) / 180) * 90;
          const rx = Math.cos((deg * Math.PI) / 180) * 90;
          return <ellipse key={deg} cx="100" cy={y} rx={rx} ry={rx * 0.12} />;
        })}
      </g>
      <path d="M78 136 C 96 112, 130 92, 168 70" fill="none" stroke="#f2994a" strokeOpacity="0.55" strokeWidth="0.9" strokeDasharray="2 3" />
      <circle cx="78" cy="136" r="7" fill="#f2994a" fillOpacity="0.18" />
      <circle cx="78" cy="136" r="2.6" fill="#f2994a" />
    </svg>
  );
}
