"use client";
import { useState } from "react";
import { Search, History, FileSearch } from "lucide-react";
import type { RecordKind, RecordMap } from "@/lib/records";
const labels: Record<RecordKind, string> = {
  agents: "Agents",
  policies: "Policies",
  claims: "Claims",
  quotes: "Quotes",
};
export function RecordDesk({
  initialKind,
  mine,
  cursor,
  onEarlier,
  onLookup,
}: {
  initialKind: RecordKind;
  mine: boolean;
  cursor: (kind: RecordKind) => number | null;
  onEarlier: (kind: RecordKind) => Promise<void>;
  onLookup: (kind: RecordKind, id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<RecordKind>(initialKind);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "We could not find that record. Try again shortly.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="record-desk" aria-label="Find older records">
      <div className="record-desk-heading">
        <FileSearch size={20} />
        <div>
          <h3>Nothing gets lost in the paperwork.</h3>
          <p>
            Look up any record by its full ID, or bring earlier pages into view.
          </p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => onLookup(kind, id));
        }}
      >
        <label>
          Record type
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RecordKind)}
          >
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Full record ID
          <input
            value={id}
            onChange={(e) => setId(e.target.value.trim().toLowerCase())}
            pattern="[a-f0-9]{24}"
            maxLength={24}
            required
            placeholder="Paste the 24 character ID"
          />
        </label>
        <button className="button secondary" disabled={busy}>
          <Search size={15} />
          {busy ? "Checking" : "Find record"}
        </button>
      </form>
      <button
        type="button"
        className="text-button"
        disabled={busy || cursor(kind) === null}
        onClick={() => void run(() => onEarlier(kind))}
      >
        <History size={15} />
        {cursor(kind) === null
          ? "All available pages are in view"
          : `Load earlier ${mine ? "account " : ""}${labels[kind].toLowerCase()}`}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export type AnyRecord = RecordMap[RecordKind];
