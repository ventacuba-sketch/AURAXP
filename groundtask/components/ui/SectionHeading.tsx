import type { ReactNode } from "react";

type SectionHeadingProps = {
  eyebrow: string;
  title: ReactNode;
  id?: string;
  className?: string;
  size?: "lg" | "md";
};

export function SectionHeading({ eyebrow, title, id, className = "", size = "lg" }: SectionHeadingProps) {
  return (
    <div className={className}>
      <p className="eyebrow">{eyebrow}</p>
      <h2
        id={id}
        className={`mt-2.5 font-semibold tracking-[-0.02em] text-ivory ${
          size === "lg" ? "text-[1.75rem] leading-[1.15] sm:text-[2.125rem] lg:text-[1.75rem] xl:text-[1.875rem]" : "text-2xl leading-tight sm:text-[1.75rem]"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}
