import { describe, it, expect } from "vitest";
import { encryptKey, decryptKey } from "../../lib/custody";
const master = "a".repeat(64);
const key = ("0x" + "b".repeat(64)) as `0x${string}`;
describe("custody isolation", () => {
  it("encrypts keys with a fresh IV for each write", () => {
    const a = encryptKey(key, master, "alice");
    const b = encryptKey(key, master, "alice");
    expect(a).not.toBe(b);
    expect(a).not.toContain(key);
    expect(decryptKey(a, master, "alice")).toBe(key);
  });
  it("cannot decrypt another account’s key", () => {
    expect(() =>
      decryptKey(encryptKey(key, master, "alice"), master, "bob"),
    ).toThrow();
  });
  it("rejects tampering and a wrong master key", () => {
    const encrypted = encryptKey(key, master, "alice");
    expect(() => decryptKey(encrypted, "c".repeat(64), "alice")).toThrow();
    const parts = encrypted.split(":");
    parts[2] = (parts[2][0] === "0" ? "1" : "0") + parts[2].slice(1);
    expect(() => decryptKey(parts.join(":"), master, "alice")).toThrow();
  });
  it("rejects a malformed master key", () =>
    expect(() => encryptKey(key, "abc", "alice")).toThrow());
});
