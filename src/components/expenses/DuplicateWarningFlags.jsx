import { ShieldAlert, AlertTriangle } from "lucide-react";

export function DuplicateWarningFlags({ flags }) {
  if (!flags || Object.keys(flags).length === 0) return null;

  const warnings = [];

  if (flags.NO_ACTIVE_TRIP) {
    warnings.push({
      id: "NO_ACTIVE_TRIP",
      title: "No Active Trip",
      message: "This expense was submitted while the driver was not on an active trip.",
      icon: ShieldAlert,
      variant: "warning",
    });
  }

  if (flags.NO_VEHICLE_ASSIGNMENT) {
    warnings.push({
      id: "NO_VEHICLE_ASSIGNMENT",
      title: "No Vehicle Assignment",
      message: "The driver had no assigned vehicle at the time of submission.",
      icon: ShieldAlert,
      variant: "danger",
    });
  }

  if (flags.UNATTRIBUTED_EXPENSE) {
    warnings.push({
      id: "UNATTRIBUTED_EXPENSE",
      title: "Unattributed Expense",
      message: "This expense could not be attributed to a specific vehicle or trip.",
      icon: ShieldAlert,
      variant: "warning",
    });
  }

  if (flags.DUPLICATE_RECEIPT_HASH) {
    warnings.push({
      id: "DUPLICATE_RECEIPT_HASH",
      title: "Duplicate Receipt Image",
      message: "An identical receipt image has been uploaded before.",
      icon: AlertTriangle,
      variant: "danger",
    });
  }

  if (flags.POTENTIAL_CARD_DUPLICATE) {
    warnings.push({
      id: "POTENTIAL_CARD_DUPLICATE",
      title: "Potential Card Duplicate",
      message: "A similar expense for this company card, merchant, and amount exists within an hour.",
      icon: AlertTriangle,
      variant: "warning",
    });
  }

  if (flags.POTENTIAL_DRIVER_DUPLICATE) {
    warnings.push({
      id: "POTENTIAL_DRIVER_DUPLICATE",
      title: "Potential Driver Duplicate",
      message: "A similar expense for this driver, merchant, and amount exists within a day.",
      icon: AlertTriangle,
      variant: "warning",
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2 mt-4">
      {warnings.map((w) => {
        const Icon = w.icon;
        const isDanger = w.variant === "danger";
        return (
          <div key={w.id} className={`flex items-start gap-3 p-3 rounded-xl border ${isDanger ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isDanger ? 'text-red-500' : 'text-amber-500'}`} />
            <div>
              <p className={`text-sm font-bold ${isDanger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>{w.title}</p>
              <p className="text-xs text-foreground-muted mt-1">{w.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
