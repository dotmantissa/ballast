import { sleep } from "workflow";
import { tickJob, continueJob } from "./steps";

export async function advanceJob(jobId:string,epoch=0,segment=0):Promise<{jobId:string;status:string}> {
  "use workflow";
  for(let tick=0;tick<64;tick++) {
    const result=await tickJob(jobId,epoch,segment);
    if(result.done)return {jobId,status:"complete"};
    await sleep(`${result.delaySeconds}s`);
  }
  await continueJob(jobId,epoch,segment);
  return {jobId,status:"continued"};
}
