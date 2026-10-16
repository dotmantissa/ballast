import { formatUnits } from "viem";
export function gen(value: string | undefined, decimals = 2) {
  if (value === undefined) return "…";
  const n = Number(formatUnits(BigInt(value), 18));
  if (n > 0 && n < 0.01)
    return n.toLocaleString("en", { maximumFractionDigits: 6 });
  return n.toLocaleString("en", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
export function short(value: string, length = 6) {
  return value.length > length * 2 + 2
    ? value.slice(0, length) + "…" + value.slice(-4)
    : value;
}
export function date(value: number) {
  return new Date(value * 1000).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function relative(value: string | number) {
  const seconds = Math.max(
    0,
    Math.round(
      (Date.now() -
        (typeof value === "number" ? value * 1000 : Date.parse(value))) /
        1000,
    ),
  );
  return seconds < 60
    ? "Just now"
    : seconds < 3600
      ? Math.floor(seconds / 60) + "m ago"
      : seconds < 86400
        ? Math.floor(seconds / 3600) + "h ago"
        : Math.floor(seconds / 86400) + "d ago";
}
export function explorer(kind: "address" | "tx", value: string) {
  return `https://explorer-studio.genlayer.com/${kind}/${value}`;
}
