import { contactHref, sampleTaskHref } from "@/lib/site";
import { ButtonLink } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { Mountains } from "../ui/Mountains";
import { HeroVisual } from "./HeroVisual";
import { revealDelay } from "@/lib/reveal";

const indicators: Array<{ icon: IconName; label: [string, string] }> = [
  { icon: "shieldCheck", label: ["Rights-cleared", "sourcing model"] },
  { icon: "lock", label: ["Anonymized", "and structured"] },
  { icon: "checkCircle", label: ["Expert QA", "built into the process"] },
];

export function Hero() {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-ink">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_75%_40%,rgb(30_42_54/0.7),transparent_70%)]" />
      <Mountains id="mt-hero" glow="warm" className="absolute right-0 bottom-0 -z-10 h-[55%] w-full opacity-80 lg:w-[70%]" />

      <div className="container-gt grid items-center gap-10 pt-24 pb-12 sm:gap-12 sm:pt-32 sm:pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-4 lg:pt-36 lg:pb-20">
        <div data-reveal>
          <p className="eyebrow text-ivory/75">Real business activity for advanced AI systems</p>
          <h1
            id="hero-title"
            className="mt-4 text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.035em] text-ivory sm:text-6xl lg:text-[3.5rem] xl:text-[4rem]"
          >
            Real-world workflows. <span className="block text-copper">Verifiable AI tasks.</span>
          </h1>
          <p className="mt-5 max-w-[34rem] sm:mt-6 text-[1.0625rem] leading-relaxed text-ivory/80 sm:text-lg">
            GroundTask transforms real business workflows from Chile/LatAm into expert-verified training and
            evaluation assets for frontier AI systems.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row">
            <ButtonLink href={contactHref} icon="mail" trailingArrow>
              Contact us
            </ButtonLink>
            <ButtonLink href={sampleTaskHref} icon="fileText" variant="secondary">
              View sample task
            </ButtonLink>
          </div>
          <ul className="mt-8 grid grid-cols-1 gap-3 sm:mt-10 sm:grid-cols-3 sm:gap-6">
            {indicators.map((item) => (
              <li key={item.icon} className="flex items-center gap-3 text-sm leading-snug text-ivory/80">
                <Icon name={item.icon} className="size-6 shrink-0 text-copper sm:size-7" strokeWidth={1.5} />
                <span>
                  {item.label[0]} <br className="hidden sm:block" />
                  {item.label[1]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div data-reveal style={revealDelay(120)} className="lg:-mr-6 lg:-ml-2 xl:-mr-12 xl:-ml-4 min-[1400px]:-mr-24">
          <HeroVisual />
        </div>
      </div>
    </section>
  );
}
