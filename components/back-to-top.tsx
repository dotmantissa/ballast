"use client";

import { ArrowUp } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(onScroll: () => void) {
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => window.removeEventListener("scroll", onScroll);
}

function isScrolled() {
  return window.scrollY > 320;
}

function serverSnapshot() {
  return false;
}

export function BackToTop() {
  const visible = useSyncExternalStore(subscribe, isScrolled, serverSnapshot);

  if (!visible) return null;

  function returnToTop() {
    const main = document.getElementById("main");
    if (main) {
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return (
    <button className="back-to-top" type="button" onClick={returnToTop}>
      <ArrowUp size={17} aria-hidden="true" />
      <span>Back to top</span>
    </button>
  );
}
