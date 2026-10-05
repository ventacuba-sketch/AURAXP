"use client";

import { useEffect, useState } from "react";
import { contactHref, navItems } from "@/lib/site";
import { Logo } from "./ui/Logo";
import { ButtonLink } from "./ui/Button";
import { Icon } from "./ui/Icon";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b ${
        open
          ? "border-line bg-graphite"
          : `transition-[background-color,border-color] duration-300 ${
              solid ? "border-line bg-graphite/85 backdrop-blur-md" : "border-transparent"
            }`
      }`}
    >
      <div className="container-gt flex h-16 items-center justify-between gap-6 lg:h-[4.5rem]">
        <a href="#top" className="focus-ring rounded-sm" aria-label="GroundTask — home">
          <Logo priority size={28} />
        </a>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-9">
            {navItems.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="focus-ring rounded-sm text-[0.875rem] text-ivory/85 transition-colors hover:text-ivory"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <ButtonLink href={contactHref} size="sm" trailingArrow>
              Contact us
            </ButtonLink>
          </div>
          <button
            type="button"
            className="focus-ring inline-flex size-10 items-center justify-center rounded-md border border-line-strong text-ivory lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>

      <div id="mobile-nav" hidden={!open} className="border-t border-line lg:hidden">
        <nav aria-label="Mobile" className="container-gt py-4">
          <ul className="flex flex-col">
            {navItems.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="focus-ring flex items-center justify-between rounded-sm border-b border-line py-3.5 text-base text-ivory/90"
                >
                  {item.label}
                  <Icon name="chevronRight" className="size-4 text-mist" />
                </a>
              </li>
            ))}
          </ul>
          <a
            href={contactHref}
            onClick={() => setOpen(false)}
            className="focus-ring mt-5 flex h-12 items-center justify-center gap-2 rounded-md bg-copper font-medium text-graphite"
          >
            Contact us <Icon name="arrowRight" className="size-4" />
          </a>
        </nav>
      </div>
    </header>
  );
}
