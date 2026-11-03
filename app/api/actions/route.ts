import {
  authenticate,
  apiError,
  checkOrigin,
  HttpError,
} from "@/lib/server/auth";
import { submitAction } from "@/lib/server/operations";
import { actionSchema } from "@/lib/validation";
import { z } from "zod";
import { queueOperation } from "@/lib/server/job-queue";
import { prepareMonitoring, releaseMonitoringReservation } from "@/lib/server/background";
import { activeDeployment } from "@/lib/deployments";
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
    if(parsed.data.kind==="monitor")await prepareMonitoring(user.id,parsed.data.agentId,parsed.data.deployment??activeDeployment.id,parsed.data.enabled);
    let operation;
    try {operation=await submitAction(user, parsed.data, key.data);}
    catch(error){
      if(parsed.data.kind==='monitor'&&parsed.data.enabled)await releaseMonitoringReservation(user.id,parsed.data.agentId,parsed.data.deployment??activeDeployment.id);
      throw error;
    }
    if(process.env.BALLAST_SPONSOR_KEY) {
      try {await queueOperation(user.id,operation.id,parsed.data);}
      catch {console.error("ballast.background.start-pending",{operationId:operation.id});}
    }
    return Response.json(operation, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
