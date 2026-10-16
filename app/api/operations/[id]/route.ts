import { authenticate, apiError, HttpError } from "@/lib/server/auth";
import { syncOperation } from "@/lib/server/operations";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authenticate(request);
    const { id } = await params;
    if (!z.uuid().safeParse(id).success)
      throw new HttpError(400, "Invalid activity reference.");
    return Response.json(await syncOperation(user.id, id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
