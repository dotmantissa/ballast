import "server-only";
import { neon, neonConfig } from "@neondatabase/serverless";
import { env } from "./env";
// Use the endpoint named by the secured connection string.
// This also works in environments that cannot reach the regional HTTP gateway.
neonConfig.fetchEndpoint = (host) => `https://${host}/sql`;
export function db() {
  return neon(env("DATABASE_URL"));
}
