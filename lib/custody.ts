import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
export function encryptKey(key: string, master: string, owner: string) {
  if (!/^[a-f0-9]{64}$/i.test(master))
    throw Error("Invalid custody key configuration");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(master, "hex"), iv);
  cipher.setAAD(Buffer.from(owner));
  const body = Buffer.concat([cipher.update(key, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body]
    .map((v) => v.toString("hex"))
    .join(":");
}
export function decryptKey(
  encoded: string,
  master: string,
  owner: string,
): `0x${string}` {
  const [iv, tag, body] = encoded.split(":").map((v) => Buffer.from(v, "hex"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(master, "hex"),
    iv,
  );
  cipher.setAAD(Buffer.from(owner));
  cipher.setAuthTag(tag);
  const value = Buffer.concat([cipher.update(body), cipher.final()]).toString(
    "utf8",
  );
  if (!/^0x[a-f0-9]{64}$/i.test(value))
    throw Error("Invalid stored signing key");
  return value as `0x${string}`;
}
