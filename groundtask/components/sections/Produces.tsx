import { revealDelay } from "@/lib/reveal";
import { FeatureCard } from "../ui/FeatureCard";
import type { IconName } from "../ui/Icon";
import { SectionHeading } from "../ui/SectionHeading";
import { DeliverableSchema } from "./DeliverableSchema";

const outputs: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: "fileText", title: "Real-world workflows", description: "Based on actual business records." },
  { icon: "clipboardCheck", title: "Verifiable tasks", description: "Realistic and challenging." },
  { icon: "database", title: "Ground truth", description: "Deterministic answers based on business rules." },
  { icon: "code", title: "Verifiers and rubrics", description: "Clear evaluation criteria for automated and human grading." },
  { icon: "userCheck", title: "Expert QA", description: "Domain experts review for accuracy and quality." },
];

export function Produces() {
  return (
    <section id="what-we-do" aria-labelledby="produces-title" className="border-t border-line bg-graphite">
      <div className="container-gt py-12 sm:py-20">
        <SectionHeading
          id="produces-title"
          eyebrow="What GroundTask produces"
          title="High-quality assets from real workflows."
          size="md"
        />
        <ul className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-7 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {outputs.map((o, i) => (
            <li key={o.title} data-reveal style={revealDelay(i * 60)} className="last:col-span-2 sm:last:col-span-1">
              <FeatureCard {...o} />
            </li>
          ))}
        </ul>

        <div className="mt-12 grid gap-6 border-t border-line pt-10 sm:mt-14 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-center lg:gap-10">
          <SectionHeading eyebrow="Delivery format" title="Ready for your AI infrastructure." size="md" />
          <DeliverableSchema />
        </div>
      </div>
    </section>
  );
}
