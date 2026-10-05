import { revealDelay } from "@/lib/reveal";
import { FeatureCard } from "../ui/FeatureCard";
import { Globe } from "../ui/Globe";
import { Icon, type IconName } from "../ui/Icon";
import { SectionHeading } from "../ui/SectionHeading";

const useCases: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: "box", title: "RL Environments", description: "Realistic, verifiable business tasks." },
  { icon: "barChart", title: "Model Evals", description: "Deterministic and rubric-based evals." },
  { icon: "network", title: "Agent Training", description: "Tool use and multi-step workflows." },
  { icon: "sliders", title: "Post-training", description: "SFT and preference data." },
  { icon: "gauge", title: "Benchmarks", description: "Domain-specific evaluation sets." },
];

const monthEndClose = [
  "Bank statements",
  "Reconciliation",
  "DTE",
  "Invoices",
  "Credit notes",
  "RCV",
  "IVA / F29",
  "Partial payments",
  "Unidentified payments",
  "Collections",
  "Discrepancies",
  "Related communications",
];

export function UseCasesAbout() {
  return (
    <>
      <section id="use-cases" aria-labelledby="usecases-title" className="border-t border-line bg-ink">
        <div className="container-gt py-12 sm:py-20">
          <SectionHeading
            id="usecases-title"
            eyebrow="Built for evaluation and training workflows"
            title="Designed for teams building advanced AI systems."
            size="md"
          />
          {/* Horizontal, swipeable rail on phones; regular grid from `sm` up. */}
          <div
            role="region"
            aria-label="Use cases"
            tabIndex={0}
            className="focus-ring -mx-4 mt-6 snap-x snap-mandatory scroll-px-4 overflow-x-auto overscroll-x-contain px-4 pb-3 [scrollbar-color:rgb(148_163_184/0.3)_transparent] [scrollbar-width:thin] sm:mx-0 sm:mt-7 sm:overflow-visible sm:px-0 sm:pb-0"
          >
            <ul className="flex gap-3 sm:grid sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {useCases.map((u, i) => (
                <li key={u.title} data-reveal style={revealDelay(i * 60)} className="w-[62%] shrink-0 snap-start sm:w-auto">
                  <FeatureCard {...u} />
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-mist sm:hidden" aria-hidden="true">
            Swipe to see all {useCases.length} <Icon name="arrowRight" className="size-3.5" />
          </p>
        </div>
      </section>

      <section
        id="about"
        aria-labelledby="about-title"
        className="relative isolate overflow-hidden border-t border-line bg-graphite"
      >
        <Globe className="absolute top-1/2 -right-24 -z-10 w-[26rem] -translate-y-1/2 opacity-60 max-lg:top-auto max-lg:-right-28 max-lg:bottom-[-6rem] max-lg:w-72 max-lg:translate-y-0" />
        <div className="container-gt grid gap-7 py-12 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-14">
          <div data-reveal>
            <SectionHeading
              id="about-title"
              eyebrow="From Chile / LatAm to global AI"
              title={
                <>
                  Local business complexity.
                  <span className="block">Global AI capability.</span>
                </>
              }
              size="md"
            />
            <p className="mt-4 max-w-lg text-base leading-relaxed text-ivory/80">
              GroundTask is being built from Chile to provide high-quality, verifiable tasks and evaluation assets for
              companies developing advanced AI systems. We start where business operations are rich in documents,
              rules and exceptions: financial, accounting and administrative processes.
            </p>
          </div>
          <div data-reveal className="rounded-xl border border-line-strong bg-ink/70 p-4 backdrop-blur-sm sm:p-6 lg:mr-24">
            <p className="text-[0.8125rem] text-mist">Initial workflow under study</p>
            <p className="mt-1 text-lg font-semibold text-ivory">Chilean Month-End Close</p>
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Workflow components">
              {monthEndClose.map((item) => (
                <li key={item} className="rounded-full border border-line-strong px-3 py-1 text-[0.8125rem] text-ivory/85">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
