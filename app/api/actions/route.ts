import {
  authenticate,
  apiError,
  checkOrigin,
  HttpError,
} from "@/lib/server/auth";
import { submitAction } from "@/lib/server/operations";
import { actionSchema } from "@/lib/validation";
import { z } from "zod";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 30000)
      throw new HttpError(413, "This submission is too large.");
    const user = await authenticate(request);
    const key = z.uuid().safeParse(request.headers.get("idempotency-key"));
    if (!key.success)
      throw new HttpError(400, "A unique submission key is required.");
    const body = await request.text();
    if (body.length > 30000)
      throw new HttpError(413, "This submission is too large.");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new HttpError(400, "The submission is not valid JSON.");
    }
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    return Response.json(await submitAction(user, parsed.data, key.data), {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
