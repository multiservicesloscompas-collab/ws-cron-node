import type { CronRuntimeState } from "./cron-runtime.ts";

export interface TargetContactSyncApi {
  syncTargetContact: (jid: string, source: string) => Promise<void>;
  syncCronRuntimeContacts?: (jids: string[]) => Promise<void>;
}

export const syncCronTargetContacts = (
  state: CronRuntimeState,
  syncApi: TargetContactSyncApi | null | undefined,
  ownJid?: string,
): Promise<void> => {
  return (async () => {
    if (!syncApi) return;

    const targets = new Set<string>();
    if (state.settings.defaultTargetJid) {
      targets.add(state.settings.defaultTargetJid);
    }

    for (const cronJob of state.cronJobs) {
      if (cronJob.targetJid) targets.add(cronJob.targetJid);
    }

    const filteredTargets = Array.from(targets).filter((jid) => jid !== ownJid);

    if (syncApi.syncCronRuntimeContacts) {
      await syncApi.syncCronRuntimeContacts(filteredTargets);
      return;
    }

    for (const jid of filteredTargets) {
      await syncApi.syncTargetContact(jid, "cron-runtime");
    }
  })();
};
