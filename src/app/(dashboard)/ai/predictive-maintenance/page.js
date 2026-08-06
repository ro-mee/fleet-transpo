import { permanentRedirect } from "next/navigation";

/**
 * Canonical location is /maintenance/predictive.
 *
 * This route was a near-identical copy of that page, which meant every fix had
 * to be applied twice — and when one was missed, the two diverged silently.
 * Kept as a redirect because the path may be bookmarked.
 *
 * permanentRedirect, not redirect: redirect() answers 307, which tells clients
 * and crawlers the move is temporary and to keep asking here. This page is gone
 * for good, so 308 is the accurate answer and lets the hop be cached.
 */
export default function AiPredictiveMaintenanceRedirect() {
  permanentRedirect("/maintenance/predictive");
}
