"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

/**
 * Helper to recursively inspect children, replacing hero header specific classes
 * with standard theme-aware button classes when rendered inside the footer.
 */
const modifyNode = (node) => {
  if (!node) return node;

  if (React.isValidElement(node)) {
    if (node.type === React.Fragment) {
      return React.cloneElement(node, {
        children: React.Children.map(node.props.children, modifyNode),
      });
    }

    let className = node.props.className;
    if (className) {
      let changed = false;
      if (className.includes(heroButtonOutlineClass)) {
        className = className.replace(
          heroButtonOutlineClass,
          "border border-border bg-surface text-foreground hover:bg-hover shadow-xs transition-colors"
        );
        changed = true;
      }
      if (className.includes(heroButtonPrimaryClass)) {
        className = className.replace(
          heroButtonPrimaryClass,
          "bg-foreground text-surface hover:bg-foreground/90 font-bold shadow-xs transition-colors"
        );
        changed = true;
      }
      if (changed) {
        return React.cloneElement(node, { className });
      }
    }

    if (node.props.children) {
      return React.cloneElement(node, {
        children: React.Children.map(node.props.children, modifyNode),
      });
    }
  }

  return node;
};

/**
 * Floating action bar for long creation forms.
 *
 * The primary save action lives in the page's HeroHeader at the top; once the
 * user scrolls past it, this bar slides up from the bottom with the same
 * actions so saving never requires scrolling back up. A zero-height sentinel
 * near the top of the page drives an IntersectionObserver — no scroll
 * listeners, so no reflow churn. The bar is `fixed`, so the `backdrop-blur`
 * is GPU-cheap (not attached to a scrolling container).
 */
export function StickyActionBar({ children, className }) {
  const sentinelRef = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-120px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const modifiedChildren = React.Children.map(children, modifyNode);

  return (
    <>
      <span ref={sentinelRef} aria-hidden="true" className="block h-px w-full" />
      <div
        aria-hidden={!show}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 pointer-events-none",
          "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          show ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
        )}
      >
        <div
          className={cn(
            "pointer-events-auto relative flex items-center gap-3 rounded-full border border-border/80 dark:border-white/12 bg-surface/95 dark:bg-zinc-900/95 px-4 py-2.5",
            "shadow-[0_20px_50px_rgba(0,0,0,0.18),0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-2xl",
            className
          )}
        >
          {/* Top specular reflection gleam */}
          <div className="absolute top-0 inset-x-6 h-[1px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/20 to-transparent pointer-events-none" />
          {modifiedChildren}
        </div>
      </div>
    </>
  );
}