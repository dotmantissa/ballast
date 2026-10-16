import { spawn } from "node:child_process";

/** Opt in only for local environments whose Node HTTP transport cannot reach Studio. */
if (process.env.BALLAST_CURL_RPC === "1") {
  const nativeFetch = globalThis.fetch;
  let queue = Promise.resolve();
  let nextRequest = 0;
  const interval = Number(process.env.BALLAST_RPC_INTERVAL_MS ?? 8000);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== "https://studio.genlayer.com/api") return nativeFetch(input, init);
    if (typeof init?.body !== "string") throw Error("Expected a JSON RPC body");
    const body = init.body;
    const prior = queue;
    let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
        nextRequest = Date.now() + interval;
        const output = await new Promise<string>((resolve, reject) => {
          const child = spawn("curl", ["--silent", "--show-error", "--max-time", "25", "--request", "POST", "--header", "Content-Type: application/json", "--data-binary", "@-", url], {stdio:["pipe","pipe","pipe"]});
          const chunks: Buffer[] = [];
          child.stdout.on("data", chunk => chunks.push(chunk));
          child.stderr.resume();
          child.once("error", () => reject(Error("Local RPC transport could not start")));
          child.once("close", code => code === 0 ? resolve(Buffer.concat(chunks).toString()) : reject(Error("Local RPC request did not complete")));
          child.stdin.end(body);
        });
        let response;
        try { response = JSON.parse(output); } catch { /* Let the SDK report malformed RPC. */ }
        if (response?.error?.code === -32029 || response?.error?.code === -32429) {
          // An explicit capacity rejection was not executed. Retry the identical request only.
          const seconds = Math.min(60, Math.max(8, Number(response.error.data?.retry_after_seconds ?? 30)+2));
          console.log("Studio capacity pause: "+seconds+" seconds.");
          nextRequest = Date.now()+seconds*1000;
          continue;
        }
        return new Response(output, {status:200,headers:{"Content-Type":"application/json"}});
      }
    } finally { release(); }
  };
}
