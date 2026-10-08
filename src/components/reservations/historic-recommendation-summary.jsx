export function HistoricRecommendationSummary({ pairs = [] }) {
  if (!pairs.length) return null;

  return (
    <section aria-label="Historic evaluation details" className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">Historic evaluation details</p>
        <p className="text-xs text-foreground-secondary">
          These findings are from the last completed evaluation. They are not current and cannot be used to select or assign an option.
        </p>
      </div>
      <ol className="space-y-2">
        {pairs.map((pair, index) => {
          const checks = Array.isArray(pair.checks) ? pair.checks.filter(Boolean) : [];
          const vehicle = pair.vehicle?.plate_number || (pair.vehicle_id != null ? `Vehicle #${pair.vehicle_id}` : "Vehicle identity unavailable");
          const driver = pair.driver?.driver_name || (pair.driver_id != null ? `Driver #${pair.driver_id}` : "Driver identity unavailable");

          return (
            <li key={`${pair.vehicle_id}:${pair.driver_id}:${index}`} className="rounded border border-border/70 bg-surface px-2.5 py-2">
              <p className="text-xs font-semibold">Historic candidate pair {index + 1}</p>
              <p className="mt-1 text-sm">{vehicle} · {driver}</p>
              {checks.length ? (
                <ul className="mt-2 space-y-1 text-xs text-foreground-secondary">
                  {checks.map((check, checkIndex) => (
                    <li key={check.id ?? `${check.label}:${checkIndex}`}>
                      {check.label}: {check.message || check.status || "No result returned"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-foreground-secondary">Check details were not returned in the saved evaluation.</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
