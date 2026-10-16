import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizePublicUrl } from "../../lib/evidence";
import { EvidenceLink } from "../../components/evidence-link";
it.each([
  "https://[invalid",
  "https://user:password@example.org/x",
  "https://example.org:444/x",
  "https://127.0.0.1/a",
  "https://host.internal/a",
  "https://under_score.example.org",
  "https://example.org\\@private.local/a",
  "javascript:alert(1)",
  "https://example.org/a b",
])("renders an unsafe public source safely: %s", (value) => {
  expect(normalizePublicUrl(value)).toBeNull();
  const html = renderToStaticMarkup(
    createElement(EvidenceLink, { url: value }),
  );
  expect(html).toContain("This source address is invalid");
  expect(html).not.toContain("href=");
  expect(html).not.toContain("password");
});
it("normalizes default ports, host casing and fragments consistently", () => {
  expect(normalizePublicUrl("https://EXAMPLE.org:443/receipt#section")).toBe(
    "https://example.org/receipt",
  );
  expect(normalizePublicUrl("https://example.org.")).toBe(
    "https://example.org/",
  );
  const html = renderToStaticMarkup(
    createElement(EvidenceLink, { url: "https://EXAMPLE.org:443/a" }),
  );
  expect(html).toContain('href="https://example.org/a"');
});
