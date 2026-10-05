import { Icon, type IconName } from "./Icon";

type FeatureCardProps = {
  icon: IconName;
  title: string;
  description: string;
  className?: string;
};

/** Compact icon + title + description card used across the feature grids. */
export function FeatureCard({ icon, title, description, className = "" }: FeatureCardProps) {
  return (
    <div
      className={`card h-full p-4 transition-colors duration-200 hover:border-copper/40 sm:p-5 ${className}`}
    >
      <Icon name={icon} className="size-7 text-copper" strokeWidth={1.5} />
      <h3 className="mt-4 text-[0.9375rem] leading-snug font-semibold text-ivory">{title}</h3>
      <p className="mt-1.5 text-[0.8125rem] leading-snug text-mist">{description}</p>
    </div>
  );
}
