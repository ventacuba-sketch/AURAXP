import Image from "next/image";
import symbol from "@/public/brand/groundtask-symbol.png";

type LogoProps = {
  className?: string;
  /** Height of the symbol in px; the wordmark scales with it. */
  size?: number;
  withWordmark?: boolean;
  priority?: boolean;
};

/**
 * GroundTask logo: brand symbol (raster, extracted from the brand guide) plus
 * the Inter wordmark — "Ground" in Medium, "Task" in SemiBold, per the guide.
 * Replace the symbol with the official SVG once it is available.
 */
export function Logo({ className = "", size = 30, withWordmark = true, priority = false }: LogoProps) {
  const width = Math.round((size * symbol.width) / symbol.height);
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Image
        src={symbol}
        alt={withWordmark ? "" : "GroundTask"}
        width={width}
        height={size}
        priority={priority}
        sizes={`${width}px`}
      />
      {withWordmark ? (
        <span
          className="tracking-[-0.02em] text-ivory"
          style={{ fontSize: Math.round(size * 0.74) }}
        >
          <span className="font-medium">Ground</span>
          <span className="font-semibold">Task</span>
        </span>
      ) : null}
    </span>
  );
}
