import { revealDelay } from "@/lib/reveal";
import { Icon, type IconName } from "../ui/Icon";
import { Mountains } from "../ui/Mountains";
import { SectionHeading } from "../ui/SectionHeading";

const pillars: Array<{ icon: IconName; title: string; description: string }> = [
  {
    icon: "checkCircle",
    title: "Licensed sourcing",
    description: "Agreements with data owners and clear terms of use.",
  },
  {
    icon: "scale",
    title: "Rights documentation",
    description: "Traceable provenance for every dataset and workflow.",
  },
  {
    icon: "eyeOff",
    title: "Anonymization",
    description: "Removal of personal and sensitive information before structuring.",
  },
  {
    icon: "clipboardList",
    title: "Quality control & QA reporting",
    description: "Expert review with explicit rejection criteria and a QA report with each delivery.",
  },
  {
    icon: "lock",
    title: "Secure handling",
    description: "Encrypted storage and controlled, least-privilege access to source material.",
  },
  {
    icon: "landmark",
    title: "Regulatory alignment",
    description:
      "Processes designed around Chile's Ley 19.628, and preparing for Ley 21.719 (applicable from December 1, 2026) and Brazil's LGPD.",
  },
];

export function Trust() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="relative isolate overflow-hidden border-t border-line bg-graphite">
      <Mountains id="mt-trust" className="absolute top-0 right-0 -z-10 hidden h-64 w-1/2 opacity-40 lg:block [mask-image:linear-gradient(to_bottom,#000_55%,transparent)] lg:w-[50%]" />
      <div className="container-gt py-16 sm:py-20">
        <SectionHeading id="trust-title" eyebrow="Trust & provenance" title="Provenance you can audit." size="md" />
        <p className="mt-4 max-w-3xl text-[0.9375rem] leading-relaxed text-ivory/75">
          Our sourcing model is built on working with companies and organizations in Chile/LatAm under clear legal
          agreements, with strict anonymization, security and quality processes applied before any asset is delivered.
        </p>
        <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <li key={p.title} data-reveal style={revealDelay(i * 60)} className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-copper/50 text-copper">
                <Icon name={p.icon} className="size-5" strokeWidth={1.6} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ivory">{p.title}</h3>
                <p className="mt-1 max-w-xs text-sm leading-snug text-mist">{p.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
