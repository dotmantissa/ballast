import { z } from "zod";
import { RECORD_KINDS } from "@/lib/records";
import {
  accountRecordPage,
  lookupRecord,
  publicRecordPage,
} from "@/lib/server/records";
import { apiError, authenticate, HttpError } from "@/lib/server/auth";
import { getAccount } from "@/lib/server/accounts";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const kind = z.enum(RECORD_KINDS).safeParse(query.get("kind"));
    const id = query.get("id");
    const cursor = query.get("cursor");
    if (
      !kind.success ||
      (id !== null && !/^[a-f0-9]{24}$/.test(id)) ||
      (cursor !== null && !/^\d{1,10}$/.test(cursor))
    )
      throw new HttpError(
        400,
        "Choose a valid record type, record ID and page.",
      );
    const value =
      id !== null
        ? { record: await lookupRecord(kind.data, id) }
        : query.get("mine") === "true"
          ? await accountRecordPage(
              (await getAccount(await authenticate(request))).address,
              kind.data,
              cursor === null ? -1 : Number(cursor),
            )
          : await publicRecordPage(
              kind.data,
              cursor === null ? undefined : Number(cursor),
            );
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
