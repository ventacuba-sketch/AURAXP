import { sampleTaskHref, site } from "@/lib/site";
import { ButtonLink } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Mountains } from "../ui/Mountains";
import { ContactForm } from "./ContactForm";

export function Contact() {
  return (
    <section id="contact" aria-labelledby="contact-title" className="relative isolate overflow-hidden border-t border-line bg-ink">
      <Mountains id="mt-contact" glow="warm" className="absolute inset-x-0 bottom-0 -z-10 h-[70%] w-full opacity-90" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/75 to-ink/30" />
      <div className="container-gt grid gap-8 py-12 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14">
        <div data-reveal>
          <h2 id="contact-title" className="text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-ivory sm:text-[2.125rem]">
            Let&apos;s build more realistic AI together.
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-ivory/80">
            Get in touch to discuss use cases, data sourcing and how GroundTask can support your evaluation and training
            needs.
          </p>
          <a
            href={`mailto:${site.email}`}
            className="focus-ring mt-5 inline-flex items-center gap-2.5 sm:mt-6 rounded-sm text-[1.0625rem] font-medium text-copper hover:text-copper-light"
          >
            <Icon name="mail" className="size-5" />
            {site.email}
          </a>
          <div className="mt-6 hidden sm:block">
            <ButtonLink href={sampleTaskHref} icon="fileText" variant="secondary" size="sm">
              View sample task
            </ButtonLink>
          </div>
        </div>
        <div data-reveal>
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
