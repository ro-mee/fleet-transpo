import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, FileText, Loader2, Maximize2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getExpenseReceiptUrl } from "@/services/expenses.service";
import { DuplicateWarningFlags } from "./DuplicateWarningFlags";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ExpenseVerificationModal({ record, onClose, onReview, isSubmitting }) {
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [loadingReceipt, setLoadingReceipt] = useState(Boolean(record?.id));
  const [remarks, setRemarks] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!record?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear async preview when the selected record closes
      setReceiptUrl(null);
      setLoadingReceipt(false);
      return;
    }
    setReceiptUrl(null);
    setLoadingReceipt(true);
    getExpenseReceiptUrl(record.id)
      .then((url) => {
        if (!cancelled) {
          setReceiptUrl(url);
          setLoadingReceipt(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load receipt URL", err);
        if (!cancelled) {
          setLoadingReceipt(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [record?.id]);

  if (!record) return null;

  const ocr = record.ocr_snapshot || {};
  const edits = record.driver_edits || {};
  const isPending = record.status === "Pending";

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verify Travel Expense</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          {/* Left Column: Receipt Viewer */}
          <div className="flex flex-col border border-border/80 rounded-xl bg-surface/50 overflow-hidden relative">
            <div className="p-3 border-b border-border/80 bg-surface flex justify-between items-center">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-foreground-secondary" />
                <span className="text-sm font-semibold text-foreground">Receipt Scan</span>
              </div>
            </div>
            <div className="flex-1 min-h-[400px] flex items-center justify-center bg-muted/30 relative p-4">
              {loadingReceipt ? (
                <div className="flex flex-col items-center gap-3 text-foreground-muted">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">Loading secure receipt...</span>
                </div>
              ) : receiptUrl ? (
                <img src={receiptUrl} alt="Expense Receipt" className="max-w-full max-h-[500px] object-contain rounded-md shadow-sm" />
              ) : (
                <div className="text-sm text-foreground-muted">Receipt could not be loaded</div>
              )}
            </div>
          </div>

          {/* Right Column: Verification Details */}
          <div className="flex flex-col space-y-6">
            
            {/* Header info */}
            <div>
              <p className="text-sm text-foreground-muted">Submitted by</p>
              <p className="font-bold text-base">
                {record.driver?.employee?.first_name} {record.driver?.employee?.last_name}
              </p>
              {record.vehicle && (
                <p className="text-xs text-foreground-muted">Vehicle: {record.vehicle.plate_number}</p>
              )}
            </div>

            {/* Warning Flags */}
            <DuplicateWarningFlags flags={record.flags} />

            {/* Comparison Grid */}
            <div className="border border-border/80 rounded-xl overflow-hidden text-sm">
              <div className="grid grid-cols-3 bg-muted/50 p-3 font-semibold text-xs uppercase tracking-wider text-foreground-secondary border-b border-border/80">
                <div>Field</div>
                <div>OCR Read</div>
                <div>Driver Confirmed</div>
              </div>

              <ComparisonRow label="Merchant" ocrVal={ocr.merchant_name} driverVal={record.merchant_name} edited={edits.merchant_name !== undefined} />
              <ComparisonRow label="Amount" ocrVal={ocr.amount ? formatCurrency(ocr.amount, record.currency) : null} driverVal={formatCurrency(record.amount, record.currency)} edited={edits.amount !== undefined} />
              <ComparisonRow label="Date" ocrVal={ocr.expense_date} driverVal={formatDate(record.expense_date)} edited={edits.expense_date !== undefined} />
              <ComparisonRow label="Category" ocrVal={ocr.inferred_category} driverVal={record.category} edited={edits.category !== undefined} />
            </div>

            {/* Payment Details */}
            <div className="bg-surface border border-border/80 rounded-xl p-4">
              <p className="text-xs uppercase font-bold text-foreground-secondary tracking-wider mb-2">Payment Details</p>
              <div className="flex justify-between items-center">
                <span className="font-semibold">{record.payment_method}</span>
                {record.payment_method === "Company Card" && record.company_card && (
                  <span className="text-xs bg-muted/50 px-2 py-1 rounded font-data">
                    {record.company_card.provider} •••• {record.company_card.card_last_four}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            {isPending && (
              <div className="pt-4 mt-auto">
                {isRejecting ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-danger">Rejection Reason</Label>
                      <Input 
                        placeholder="Why is this expense being rejected?" 
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => setIsRejecting(false)}>
                        Cancel
                      </Button>
                      <Button 
                        variant="destructive" 
                        className="flex-1"
                        disabled={isSubmitting || !remarks.trim()}
                        onClick={() => onReview("Reject", remarks)}
                      >
                        {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <XCircle className="w-4 h-4 mr-2" />}
                        Confirm Rejection
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 text-danger border-danger/30 hover:bg-danger/10"
                      onClick={() => setIsRejecting(true)}
                      disabled={isSubmitting}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      className="flex-1 bg-success hover:bg-success/90 text-white"
                      disabled={isSubmitting}
                      onClick={() => onReview("Approve", null)}
                    >
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!isPending && (
              <div className="pt-4 mt-auto">
                <div className="p-3 bg-muted/30 rounded-lg text-sm">
                  <p className="font-semibold">This expense has been {record.status.toLowerCase()}.</p>
                  {record.review_remarks && (
                    <p className="text-foreground-muted mt-1 italic">&ldquo;{record.review_remarks}&rdquo;</p>
                  )}
                  {record.reviewer && (
                    <p className="text-xs text-foreground-muted mt-2">
                      Reviewed by {record.reviewer.first_name} {record.reviewer.last_name}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComparisonRow({ label, ocrVal, driverVal, edited }) {
  return (
    <div className="grid grid-cols-3 p-3 border-b border-border/80 last:border-0 items-center">
      <div className="font-semibold text-foreground-secondary">{label}</div>
      <div className="text-foreground-muted truncate pr-2">
        {ocrVal || "—"}
      </div>
      <div className={`font-medium ${edited ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
        {driverVal || "—"}
      </div>
    </div>
  );
}
