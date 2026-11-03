import catalog from "../deployments/catalog.json";
import active from "../deployments/studio.json";

export type Deployment = {
  id: string;
  label: string;
  version: number;
  indexed: boolean;
  registry: string;
  underwriting: string;
  court: string;
  assurance?: string;
  chainId: number;
  network: string;
};
export const deployments: Deployment[] = catalog;
export const activeDeployment = deployments.find(
  (d) => d.underwriting.toLowerCase() === active.underwriting.toLowerCase(),
)!;
if (!activeDeployment) throw new Error("Active deployment is missing from the catalog");

export function deploymentById(id?: string): Deployment {
  if (!id) return activeDeployment;
  const deployment = deployments.find((d) => d.id === id);
  if (!deployment) throw new Error("Unknown deployment generation");
  return deployment;
}
