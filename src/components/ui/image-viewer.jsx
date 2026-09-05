"use client";

import { useEffect, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

const subscribe = () => () => {};

export function ImageViewer({ url, onClose }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  useEffect(() => {
    if (!url) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    // Use capture phase to intercept the Escape key before Radix Dialog sees it
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [url, onClose]);

  if (!url || !mounted) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out animate-in fade-in duration-200 pointer-events-auto"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="relative flex items-center justify-center max-w-full max-h-full">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className="absolute -top-4 -right-4 md:-top-6 md:-right-6 z-50 p-2 rounded-full bg-white/10 hover:bg-white/30 text-white backdrop-blur-md border border-white/20 transition-all shadow-xl cursor-pointer pointer-events-auto"
          title="Close image (Esc)"
        >
          <X className="w-5 h-5 md:w-6 md:h-6" />
        </button>
        <img 
          src={url} 
          alt="Full screen view" 
          className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl cursor-default pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>,
    document.body
  );
}
