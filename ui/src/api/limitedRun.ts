import { type Limits, putLimits } from "./limits";
import { startRun } from "./runs";

/**
 * Starts a run with these limits, then saves them. Only a run that started saves its limits, so a
 * failed click freezes nothing. The run has the limits already, so a failed save must not stop it.
 */
export async function startLimitedRun(planId: string, limits: Limits): Promise<string> {
  const { run_id } = await startRun({ plan_id: planId, mode: "enforce", limits });
  await putLimits(limits, planId).catch(() => {});
  return run_id;
}
