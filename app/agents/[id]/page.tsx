import { PassportDesk } from "@/components/passport-desk";
import { notFound } from "next/navigation";
export default async function AgentPassportPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{deployment?:string}>}) {
  const {id}=await params;
  if(!/^[a-f0-9]{24}$/.test(id))notFound();
  const {deployment}=await searchParams;
  return <PassportDesk agentId={id} deploymentId={deployment}/>;
}
