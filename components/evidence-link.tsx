import { ExternalLink, FileText, AlertCircle } from "lucide-react";
import { normalizePublicUrl, evidenceHost } from "@/lib/evidence";
export function EvidenceLink({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const href = normalizePublicUrl(url);
  if (!href)
    return (
      <span className="invalid-source">
        <AlertCircle size={15} aria-hidden="true" /> This source address is
        invalid.
      </span>
    );
  return (
    <a
      className={compact ? "source-link" : undefined}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {!compact && <FileText size={15} aria-hidden="true" />}
      <span>
        {evidenceHost(href)}
        {!compact && <small>{url}</small>}
      </span>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}
