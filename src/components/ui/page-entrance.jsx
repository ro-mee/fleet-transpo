"use client";

import { MotionConfig, motion } from "framer-motion";

// Same ease curve the auth and analytics surfaces use. One authored moment per
// page: a gentle fade-up on mount, collapsed by MotionConfig for reduced-motion.
const EASE = [0.32, 0.72, 0, 1];

// Floating-card language shared by the record-creation pages. The hard edge
// stays crisp (1px border), the lift comes from the soft second shadow.
export const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(17,24,39,0.04),0_18px_40px_-32px_rgba(17,24,39,0.22)]";

export function PageEntrance({ children, className }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}