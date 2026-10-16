import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
// One local Studio writer at a time protects shared nonces and deployment records.
const path = execFileSync("git", ["rev-parse", "--git-path", "ballast-studio.lock"], {encoding:"utf8"}).trim();
for (;;) {
  try { writeFileSync(path, String(process.pid), {flag:"wx",mode:0o600}); break; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(readFileSync(path,"utf8"));
    try { process.kill(pid,0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") { unlinkSync(path); continue; }
      throw error;
    }
    throw Error("Another local Studio workflow is running. Resume it before starting another writer.");
  }
}
process.once("exit", () => { try { if (readFileSync(path,"utf8")===String(process.pid)) unlinkSync(path); } catch { /* Already released. */ } });
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));
