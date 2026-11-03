import { getPassportBundle } from "@/lib/server/passports";
import { apiError, HttpError } from "@/lib/server/auth";
import { deploymentById } from "@/lib/deployments";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{id:string}> }) {
  try {
    const { id } = await params;
    if (!/^[a-f0-9]{24}$/.test(id)) throw new HttpError(400,"Use a valid agent ID.");
    let deployment;
    try { deployment = deploymentById(new URL(request.url).searchParams.get("deployment") ?? undefined); }
    catch { throw new HttpError(400,"Unknown deployment generation."); }
    return Response.json(await getPassportBundle(id,deployment), {headers:{"Cache-Control":"public, max-age=30"}});
  } catch (error) { return apiError(error); }
}
