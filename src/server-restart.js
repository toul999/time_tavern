import fs from "node:fs";

// Captured on module import, before the launcher loads the old .env file.
export const startupEnvironment = { ...process.env };

export function usesContainerRestart(env = process.env, exists = fs.existsSync) {
  if (env.TIME_TAVERN_RESTART_MODE === "process") return false;
  if (env.TIME_TAVERN_RESTART_MODE === "container") return true;
  return exists("/.dockerenv") || exists("/run/.containerenv");
}

export function restartEnvironment(current, initial, restoringData) {
  // On restore, do not pass values loaded from the old .env to the new process.
  return { ...(restoringData ? initial : current) };
}
