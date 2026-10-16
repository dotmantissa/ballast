import "server-only";
import { neon } from "@neondatabase/serverless";
import { env } from "./env";
export function db() {
  return neon(env("DATABASE_URL"));
}
