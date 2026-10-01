"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { JOB_STATUSES, type JobStatus } from "@/domain";

export function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub ? <div className="tile-sub">{sub}</div> : null}
    </div>
  );
}

const TONE: Record<JobStatus, string> = {
  Saved: "neutral",
  Applied: "active",
  "HR screen": "active",
  "Tech interview": "active",
  "Behavior interview": "active",
  Final: "warning",
  Offer: "good",
  Reject: "critical",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className="badge" data-tone={TONE[status] ?? "neutral"}>
      {status}
    </span>
  );
}

/**
 * The badge IS the control: the pill is the Radix trigger and the list is our
 * own menu, so it matches the rest of the interface instead of the operating
 * system's grey box.
 */
export function StatusSelect({
  status,
  onChange,
  disabled,
}: {
  status: JobStatus;
  onChange: (next: JobStatus) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={status} onValueChange={(next) => onChange(next as JobStatus)} disabled={disabled}>
      <SelectTrigger
        className="badge status-trigger"
        data-tone={TONE[status] ?? "neutral"}
        aria-label={"Status — " + status}
        chevronSize={12}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_STATUSES.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
