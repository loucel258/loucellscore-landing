"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BookViaChatButton } from "@/components/chat/book-via-chat-button";
import { locales, type Locale } from "@/i18n/config";
import type { HomeCopy } from "./copy";

/**
 * HomeNav — reads the `data-nav-theme` of whatever section sits under it
 * (dark hero / dusk CTA vs paper sections) and flips its own palette.
 * Mobile gets a real menu (the previous nav hid every link under md).
 */
export function HomeNav({ locale, copy }: { locale: Locale; copy: HomeCopy["nav"] }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const probe = 36;
      const sections = document.querySelectorAll<HTMLElement>("[data-nav-theme]");
      let next: "dark" | "light" = "light";
      for (const el of sections) {
        const r = el.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          next = el.dataset.navTheme === "dark" ? "dark" : "light";
          break;
        }
      }
      setTheme(next);
      setSolid(window.scrollY > 24);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const dark = theme === "dark";
  const bar = dark
    ? solid
      ? "bg-night/55 border-white/10 text-bone"
      : "bg-transparent border-transparent text-bone"
    : "bg-paper/80 border-rule text-ink";

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50">
        <div
          className={`border-b transition-colors duration-500 ${bar} ${
            dark && !solid ? "" : "backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)]"
          }`}
        >
          <div className="lc-wrap flex h-16 items-center justify-between gap-6">
            <Link href={`/${locale}`} className="flex items-baseline gap-2" aria-label="Loucells Core">
              <span className="font-serif text-[1.45rem] leading-none tracking-tight">Loucells</span>
              <span className="lc-label text-[0.68rem] opacity-70">Core</span>
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-7 text-[14px] lg:flex">
              {copy.links.map((l) => (
                <Link key={l.href} href={`/${locale}${l.href}`} className="opacity-75 transition-opacity hover:opacity-100">
                  {l.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-3 sm:gap-4">
              <LocaleToggle current={locale} />
              <BookViaChatButton
                className={`hidden h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors sm:inline-flex ${
                  dark ? "bg-bone text-ink hover:bg-white" : "bg-ink text-paper hover:bg-ink-2"
                }`}
              >
                {copy.cta}
                <ArrowUpRight className="size-3.5" strokeWidth={2} />
              </BookViaChatButton>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={copy.menu}
                aria-expanded={open}
                aria-controls="home-menu"
                className="-mr-2 inline-flex size-11 items-center justify-center rounded-full lg:hidden"
              >
                <Menu className="size-5" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            id="home-menu"
            role="dialog"
            aria-modal="true"
            aria-label={copy.menu}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[60] flex flex-col bg-night text-bone lg:hidden"
          >
            <div className="lc-wrap flex h-16 items-center justify-between">
              <span className="font-serif text-[1.45rem]">Loucells</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={copy.close}
                className="-mr-2 inline-flex size-11 items-center justify-center rounded-full"
                autoFocus
              >
                <X className="size-5" strokeWidth={1.75} />
              </button>
            </div>
            <nav aria-label="Mobile" className="lc-wrap flex flex-1 flex-col justify-center gap-1">
              {copy.links.map((l, i) => (
                <motion.div
                  key={l.href}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href={`/${locale}${l.href}`}
                    onClick={() => setOpen(false)}
                    className="font-serif text-[2.6rem] leading-[1.15]"
                  >
                    {l.label}
                  </Link>
                </motion.div>
              ))}
            </nav>
            <div className="lc-wrap pb-10" onClickCapture={() => setOpen(false)}>
              <BookViaChatButton className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-dawn text-[15px] font-medium text-ink">
                {copy.cta}
                <ArrowUpRight className="size-4" strokeWidth={2} />
              </BookViaChatButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function LocaleToggle({ current }: { current: Locale }) {
  // Keep the visitor on the same page when switching language.
  const pathname = usePathname() ?? `/${current}`;
  const rest = pathname.replace(/^\/(en|es)(?=\/|$)/, "");
  return (
    <div className="lc-label flex items-center gap-1 text-[0.72rem]">
      {locales.map((l) => (
        <Link
          key={l}
          href={`/${l}${rest}`}
          hrefLang={l}
          aria-current={l === current ? "true" : undefined}
          className={`rounded-full px-2 py-1.5 transition-opacity ${
            l === current ? "opacity-100 underline decoration-1 underline-offset-4" : "opacity-55 hover:opacity-100"
          }`}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
