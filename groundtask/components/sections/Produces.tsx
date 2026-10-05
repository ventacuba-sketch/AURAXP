import { revealDelay } from "@/lib/reveal";
import { FeatureCard } from "../ui/FeatureCard";
import type { IconName } from "../ui/Icon";
import { SectionHeading } from "../ui/SectionHeading";

const outputs: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: "fileText", title: "Real-world workflows", description: "Based on actual business records." },
  { icon: "clipboardCheck", title: "Verifiable tasks", description: "Realistic and challenging." },
  { icon: "database", title: "Ground truth", description: "Deterministic answers based on business rules." },
  { icon: "code", title: "Verifiers and rubrics", description: "Clear evaluation criteria for automated and human grading." },
  { icon: "userCheck", title: "Expert QA", description: "Domain experts review for accuracy and quality." },
];

const delivery: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: "fileText", title: "Structured task data", description: "Tasks, documents and metadata." },
  { icon: "database", title: "Ground truth", description: "Verified answers and explanations." },
  { icon: "code", title: "Verifier specification", description: "Evaluation criteria and scoring logic." },
  { icon: "clipboardList", title: "QA metadata", description: "Review notes, quality flags and annotations." },
];

export function Produces() {
  return (
    <section id="what-we-do" aria-labelledby="produces-title" className="border-t border-line bg-graphite">
      <div className="container-gt py-16 sm:py-20">
        <SectionHeading
          id="produces-title"
          eyebrow="What GroundTask produces"
          title="High-quality assets from real workflows."
          size="md"
        />
        <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {outputs.map((o, i) => (
            <li key={o.title} data-reveal style={revealDelay(i * 60)}>
              <FeatureCard {...o} />
            </li>
          ))}
        </ul>

        <div className="mt-14 grid gap-7 border-t border-line pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-10">
          <div>
            <SectionHeading eyebrow="Delivery format" title="Ready for your AI infrastructure." size="md" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-mist">
              Delivery formats and schemas are defined with each team to fit their training or evaluation pipeline.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {delivery.map((d, i) => (
              <li key={d.title} data-reveal style={revealDelay(i * 60)}>
                <FeatureCard {...d} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
