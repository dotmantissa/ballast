import { spawn } from "node:child_process";

/** Opt in only for local environments whose Node HTTP transport cannot reach Studio. */
if (process.env.BALLAST_CURL_RPC === "1") {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url !== "https://studio.genlayer.com/api")
      return nativeFetch(input, init);
    if (typeof init?.body !== "string") throw Error("Expected a JSON RPC body");
    const body = init.body;
    return await new Promise<Response>((resolve, reject) => {
      const child = spawn(
        "curl",
        [
          "--silent",
          "--show-error",
          "--max-time",
          "25",
          "--request",
          "POST",
          "--header",
          "Content-Type: application/json",
          "--data-binary",
          "@-",
          url,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.stderr.resume();
      child.once("error", () =>
        reject(Error("Local RPC transport could not start")),
      );
      child.once("close", (code) =>
        code === 0
          ? resolve(
              new Response(Buffer.concat(chunks).toString(), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            )
          : reject(Error("Local RPC request did not complete")),
      );
      child.stdin.end(body);
    });
  };
}
