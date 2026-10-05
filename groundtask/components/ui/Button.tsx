import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary";

const base =
  "focus-ring inline-flex items-center justify-center gap-2.5 rounded-md text-[0.9375rem] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 active:translate-y-px";

const variants: Record<Variant, string> = {
  primary:
    "bg-copper text-graphite shadow-copper hover:bg-copper-light",
  secondary:
    "border border-ivory/45 text-ivory hover:border-ivory hover:bg-ivory/5",
};

const sizes = {
  md: "h-12 px-5",
  sm: "h-10 px-4 text-sm",
} as const;

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: keyof typeof sizes;
  icon?: IconName;
  trailingArrow?: boolean;
  className?: string;
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  icon,
  trailingArrow = false,
  className = "",
}: ButtonLinkProps) {
  return (
    <a href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {icon ? <Icon name={icon} className="size-[1.15rem]" /> : null}
      <span>{children}</span>
      {trailingArrow ? <Icon name="arrowRight" className="size-4" /> : null}
    </a>
  );
}

export const buttonClasses = { base, variants, sizes };
