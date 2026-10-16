import { getOverview } from "@/lib/server/chain";
import { apiError } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await getOverview(), {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=15",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
