export function repairPerformerLabel(record) {
  return record?.repair_completed_by_name?.trim() || "Not recorded";
}
