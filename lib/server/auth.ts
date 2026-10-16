import "server-only";
import { PrivyClient } from "@privy-io/server-auth";
import { env } from "./env";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let client: PrivyClient;
const emailCache = new Map<string, { email: string; expires: number }>();
export async function authenticate(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Sign in with your email to continue.");
  client ??= new PrivyClient(env("PRIVY_APP_ID"), env("PRIVY_APP_SECRET"));
  try {
    const claims = await client.verifyAuthToken(token);
    const cached = emailCache.get(claims.userId);
    if (cached && cached.expires > Date.now())
      return { id: claims.userId, email: cached.email };
    const user = await client.getUser(claims.userId);
    if (!user.email?.address)
      throw new HttpError(403, "An email account is required.");
    if (emailCache.size > 500) emailCache.clear();
    emailCache.set(claims.userId, {
      email: user.email.address,
      expires: Date.now() + 60000,
    });
    return { id: claims.userId, email: user.email.address };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      401,
      "Your session has expired. Sign in again to continue.",
    );
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError(403, "This request came from a different site.");
}
export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  // Database and SDK errors can contain connection strings or request headers.
  // Never serialize or log raw provider errors.
  return Response.json(
    {
      error:
        "The service could not complete this request. Your saved activity is safe. Please try again.",
    },
    { status: 503 },
  );
}
