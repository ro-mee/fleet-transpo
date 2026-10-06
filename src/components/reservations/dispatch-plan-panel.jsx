"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AiRecommendationPanel } from "@/components/reservations/ai-recommendation-panel";

export function DispatchPlanPanel({
  selectedRequest = null,
  canAssign = false,
  onAssigned,
  onBusyChange,
  planHook,
  isDesktop = true,
  isMobileDrawerOpen = false,
  isBusy = false,
  mobileOpenerRef = null,
  mobileFallbackRef = null,
  onCloseMobileDrawer,
}) {
  const [operation, setOperation] = useState(null);
  const closeButtonRef = useRef(null);
  const desktop = operation?.desktop ?? isDesktop;
  const drawerBusy = Boolean(isBusy || operation);
  const handleBusy = useCallback(busy => {
    setOperation(previous => busy ? previous ?? {desktop} : null);
    onBusyChange?.(busy);
  }, [desktop,onBusyChange]);
  const handleOpenAutoFocus = event => {
    event.preventDefault();
    closeButtonRef.current?.focus();
  };
  const handleCloseAutoFocus = event => {
    event.preventDefault();
    const opener = mobileOpenerRef?.current;
    if (typeof opener?.focus === "function" && opener.isConnected !== false) opener.focus();
    else mobileFallbackRef?.current?.focus();
  };
  const handleDismiss = open => {
    if (!open && !drawerBusy) onCloseMobileDrawer?.();
  };
  const blockDismissWhileBusy = event => {
    if (drawerBusy) event.preventDefault();
  };
  const plan = planHook?.plan;
  const proposal = useMemo(() => {
    if (!selectedRequest || !planHook?.getProposal) return null;
    return planHook.getProposal(selectedRequest.request_id);
  }, [selectedRequest, planHook]);

  // Desktop persistent workstation aside
  if (desktop) {
    return (
      <aside
        aria-label="Dispatch Copilot Workstation"
        className="hidden xl:flex flex-col w-[460px] 2xl:w-[490px] shrink-0 sticky top-20 max-h-[calc(100vh-6rem)] rounded-3xl border border-border/80 bg-surface shadow-xs overflow-hidden"
      >
        <AiRecommendationPanel
          key={selectedRequest?.request_id || "copilot-aside-empty"}
          requestId={selectedRequest?.request_id}
          selectedRequest={selectedRequest}
          canAssign={canAssign}
          queueMode
          planValidation={planHook?.validation}
          planInvalidReason={planHook?.invalidReason}
          onBusyChange={handleBusy}
          onAssigned={onAssigned}
          alreadyAssigned={['Assigned', 'In Progress', 'Completed', 'Cancelled'].includes(selectedRequest?.fleet_status)}
          planProposal={proposal}
          planToken={proposal ? plan?.planToken : null}
          planExpiresAt={plan?.expiresAt}
          onPlanStale={() => planHook?.setStale(true)}
          pickupAt={selectedRequest?.pickup_datetime}
          plan={plan}
          planError={planHook?.failure}
          onReanalyze={(date) => planHook?.analyze.mutateAsync(date)}
          isAnalyzing={planHook?.analyze.isPending}
        />
      </aside>
    );
  }

  // Responsive Drawer/Dialog for narrower viewports (< xl)
  // Mounted strictly when isMobileDrawerOpen is true to preserve single-body mount policy
  if (!isMobileDrawerOpen) {
    return null;
  }

  return (
    <Dialog open={isMobileDrawerOpen} onOpenChange={handleDismiss}>
      <DialogContent
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={blockDismissWhileBusy}
        onPointerDownOutside={blockDismissWhileBusy}
        className="left-auto right-0 top-0 translate-x-0 translate-y-0 h-dvh max-h-dvh w-full max-w-lg rounded-none p-0 bg-surface flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border/80 bg-muted/20 shrink-0">
          <DialogTitle className="text-sm font-bold flex items-center gap-2.5 text-foreground">
            <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs">
              <img src="/images/copilot-avatar-blinking.gif" alt="" aria-hidden="true" className="w-full h-full object-cover select-none pointer-events-none" />
              <span className="absolute bottom-0 right-0 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-surface" aria-hidden="true" />
            </div>
            Dispatch Copilot
          </DialogTitle>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="xs"
            disabled={drawerBusy}
            onClick={() => handleDismiss(false)}
            className="rounded-lg h-7 px-2.5 text-xs text-foreground-secondary hover:text-foreground"
          >
            Close
          </Button>
        </div>
        {drawerBusy && (
          <p role="status" className="shrink-0 border-b border-border bg-muted/20 px-4 py-2 text-xs text-foreground-secondary">
            A Copilot operation is in progress. Close will be available when it finishes.
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <AiRecommendationPanel
            key={selectedRequest?.request_id || "copilot-drawer-empty"}
            requestId={selectedRequest?.request_id}
            selectedRequest={selectedRequest}
            canAssign={canAssign}
            queueMode
            planValidation={planHook?.validation}
            planInvalidReason={planHook?.invalidReason}
            onBusyChange={handleBusy}
            onAssigned={(res) => {
              onAssigned?.(res);
            }}
            alreadyAssigned={['Assigned', 'In Progress', 'Completed', 'Cancelled'].includes(selectedRequest?.fleet_status)}
            planProposal={proposal}
            planToken={proposal ? plan?.planToken : null}
            planExpiresAt={plan?.expiresAt}
            onPlanStale={() => planHook?.setStale(true)}
            pickupAt={selectedRequest?.pickup_datetime}
            plan={plan}
            planError={planHook?.failure}
            onReanalyze={(date) => planHook?.analyze.mutateAsync(date)}
            isAnalyzing={planHook?.analyze.isPending}
            hideHeader
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
