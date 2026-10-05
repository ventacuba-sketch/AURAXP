import { navItems, site } from "@/lib/site";
import { Logo } from "./ui/Logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink">
      <div className="container-gt flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo size={24} />
          <p className="mt-3 text-[0.8125rem] text-mist">{site.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem] text-ivory/75">
            {navItems.map((item) => (
              <li key={item.href}>
                <a className="focus-ring rounded-sm hover:text-ivory" href={item.href}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="text-[0.8125rem] text-mist md:text-right">
          <a className="focus-ring rounded-sm text-ivory/85 hover:text-copper" href={`mailto:${site.email}`}>
            {site.email}
          </a>
          <p className="mt-1">© {new Date().getFullYear()} GroundTask · Chile</p>
        </div>
      </div>
    </footer>
  );
}
