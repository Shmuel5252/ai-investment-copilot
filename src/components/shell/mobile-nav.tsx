"use client";

import { useEffect, useRef, useState } from "react";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { Icon } from "./icons";
import { shell } from "@/lib/i18n/strings";

// Narrow screens: a top bar with one menu button, and the navigation in a
// native <dialog>. The element gives us focus trapping, Escape and the
// backdrop for free; the drawer slides in from the start edge (the right
// edge in RTL), which is where the sidebar lives on desktop.
export function MobileNav() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3"
      >
        <Icon name="menu" size={20} />
        <span className="sr-only">{shell.openMenu}</span>
      </button>

      <dialog
        id="mobile-navigation"
        ref={dialog}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // a click on the backdrop lands on the dialog element itself
          if (e.target === dialog.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-surface-2 p-0 text-ink shadow-panel backdrop:bg-ink/40 open:flex open:flex-col"
        style={{ insetInlineStart: 0, insetInlineEnd: "auto" }}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <p className="font-serif text-lg font-bold">{shell.productName}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3"
          >
            <Icon name="close" size={20} />
            <span className="sr-only">{shell.closeMenu}</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <NavLinks dense onNavigate={() => setOpen(false)} />
        </div>
        <div className="border-t border-rule px-2 py-3">
          <UserMenu />
        </div>
      </dialog>
    </>
  );
}
