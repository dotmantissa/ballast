/** Public records are untrusted, including records submitted directly to the contracts. */
export function normalizePublicUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    /[\s\\\u0000-\u001f]/.test(value)
  )
    return null;
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || !/^[a-z0-9.:-]+$/i.test(authority)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.+$/, "");
    const labels = host.split(".");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      host.length > 253 ||
      labels.length < 2 ||
      !/^[a-z]{2,63}$/.test(labels.at(-1)!) ||
      ["local", "internal", "localhost", "onion"].includes(labels.at(-1)!)
    )
      return null;
    if (
      labels.some(
        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
      )
    )
      return null;
    url.hostname = host;
    url.port = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
export function evidenceHost(value: unknown): string | null {
  const safe = normalizePublicUrl(value);
  return safe ? new URL(safe).hostname : null;
}
