"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, isActiveRoute } from "./nav-config";
import { Icon } from "./icons";
import { shell } from "@/lib/i18n/strings";

// The grouped navigation list, used by the desktop sidebar and the mobile
// drawer alike. Active state comes from the pathname through the one pure
// matcher in nav-config.ts; `aria-current="page"` carries it to assistive
// technology, the accent carries it to the eye.
export function NavLinks({ onNavigate, dense = false }: { onNavigate?: () => void; dense?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label={shell.mainNavigation} className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-semibold text-muted">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActiveRoute(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex items-center gap-2.5 rounded-md px-3 text-sm",
                      dense ? "py-2.5" : "py-1.5",
                      active
                        ? "bg-surface font-semibold text-accent shadow-[inset_0_0_0_1px_var(--color-rule)]"
                        : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                    ].join(" ")}
                  >
                    <Icon name={item.icon} size={18} className={active ? "text-accent" : "text-muted"} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
