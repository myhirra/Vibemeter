import type { ImportResult } from './collectors/session-importer';

type Importer = () => ImportResult | Promise<ImportResult>;

export function createSessionRefreshRunner(importer: Importer) {
  let inFlight: Promise<ImportResult> | null = null;

  return {
    refreshSessions() {
      if (!inFlight) {
        try {
          inFlight = Promise.resolve(importer()).finally(() => {
            inFlight = null;
          });
        } catch (error) {
          inFlight = null;
          throw error;
        }
      }
      return inFlight;
    },
  };
}

const defaultRunner = createSessionRefreshRunner(async () => {
  const { importSessions } = await import('./collectors/session-importer');
  return importSessions();
});

export function refreshSessions() {
  return defaultRunner.refreshSessions();
}
