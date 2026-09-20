export const SAMPLE_FUEL_RECEIPT = Object.freeze({
  station: "Shell Skyway North",
  fuelType: "Diesel",
  liters: "42.50",
  pricePerLiter: "68.50",
  printedTotal: "2911.25",
  simulatedOcrTotal: "2911.75",
  date: "2026-09-20",
});

export function formatSampleCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "₱0.00";
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
