import { revealDelay } from "@/lib/reveal";
import { Icon } from "../ui/Icon";
import { SectionHeading } from "../ui/SectionHeading";

const steps = [
  { title: "Source", description: "Obtain real workflows and records." },
  { title: "Rights", description: "Secure the necessary rights for training and evaluation use." },
  { title: "Anonymize", description: "Remove sensitive information and standardize data." },
  { title: "Structure", description: "Convert workflows into tasks, ground truth and verifiers." },
  { title: "Verify", description: "Domain experts validate tasks and solutions." },
  { title: "Deliver", description: "Training and evaluation assets ready for your AI systems." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="border-t border-line bg-ink">
      <div className="container-gt py-12 sm:py-20">
        <SectionHeading id="how-title" eyebrow="How it works" title="A clear and auditable process." size="md" />
        <ol className="mt-8 grid grid-cols-2 gap-x-4 gap-y-7 sm:mt-10 sm:grid-cols-3 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-6 lg:gap-x-4">
          {steps.map((step, i) => (
            <li key={step.title} data-reveal style={revealDelay(i * 90)} className="group relative">
              <div className="flex items-center gap-3">
                <span
                  className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-[0.9375rem] font-semibold transition-colors duration-300 sm:size-10 ${
                    i === 0
                      ? "bg-copper/15 text-copper ring-2 ring-copper ring-offset-4 ring-offset-ink"
                      : "bg-copper text-graphite group-hover:bg-copper-light"
                  }`}
                >
                  {i + 1}
                </span>
                <h3 className="text-[0.9375rem] font-semibold text-ivory sm:hidden">{step.title}</h3>
                {i < steps.length - 1 ? (
                  <span aria-hidden="true" className="hidden flex-1 items-center text-copper/80 lg:flex">
                    <span className="h-px flex-1 bg-gradient-to-r from-copper/20 to-copper/70" />
                    <Icon name="chevronRight" className="-ml-1.5 size-3.5" strokeWidth={2} />
                  </span>
                ) : null}
              </div>
              <div className="mt-2.5 sm:mt-4">
                <h3 className="hidden text-base font-semibold text-ivory sm:block">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-mist sm:mt-1 sm:max-w-[17rem] lg:pr-2">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
