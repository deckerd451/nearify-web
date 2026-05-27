import { logger } from "./logger.js";

const jobs = new Map();
const isDev = (() => {
  try {
    return Boolean(window?.NEARIFY_ENV === "development" || window?.location?.hostname === "localhost");
  } catch {
    return false;
  }
})();

function debugLog(...args) {
  if (isDev) logger.log("[PollingCoordinator]", ...args);
}

function clearTimer(job) {
  if (!job?.timerId) return;
  window.clearTimeout(job.timerId);
  job.timerId = null;
}

function schedule(job, immediate = false) {
  clearTimer(job);
  const delay = immediate ? 0 : job.intervalMs + Math.floor(Math.random() * (job.jitterMs || 0));
  job.timerId = window.setTimeout(async () => {
    if (document.visibilityState === "hidden") {
      debugLog("pause hidden tab", { key: job.key });
      schedule(job, false);
      return;
    }
    if (job.inFlight) {
      debugLog("skip in-flight", { key: job.key });
      schedule(job, false);
      return;
    }
    job.inFlight = true;
    try {
      await job.run();
    } catch (error) {
      logger.warn("[PollingCoordinator] job error", { key: job.key, error });
    } finally {
      job.inFlight = false;
      schedule(job, false);
    }
  }, delay);
}

function register({ key, run, intervalMs, jitterMs = 0, immediate = false }) {
  if (!key || typeof run !== "function") throw new Error("Polling job requires key + run fn");
  const existing = jobs.get(key);
  if (existing) {
    if (existing.run === run && existing.intervalMs === intervalMs) {
      debugLog("duplicate blocked", { key, activeJobs: jobs.size });
      return existing;
    }
    clearTimer(existing);
    jobs.delete(key);
    debugLog("replacing existing job", { key });
  }

  const job = { key, run, intervalMs: Math.max(15000, intervalMs), jitterMs, inFlight: false, timerId: null };
  jobs.set(key, job);
  debugLog("job started", { key, intervalMs: job.intervalMs, jitterMs, activeJobs: jobs.size });
  schedule(job, immediate);
  return job;
}

function stop(key) {
  const job = jobs.get(key);
  if (!job) return;
  clearTimer(job);
  jobs.delete(key);
  debugLog("job stopped", { key, activeJobs: jobs.size });
}

function stopAll() {
  for (const key of jobs.keys()) stop(key);
}

function handleVisibility() {
  if (document.visibilityState === "visible") {
    debugLog("resume visible tab", { activeJobs: jobs.size });
    for (const job of jobs.values()) schedule(job, true);
  } else {
    debugLog("pause all hidden tab", { activeJobs: jobs.size });
  }
}

document.addEventListener("visibilitychange", handleVisibility);
window.addEventListener("pagehide", stopAll);
window.addEventListener("beforeunload", stopAll);

window.__nearifyPollingDebug = function __nearifyPollingDebug() {
  const snapshot = [...jobs.values()].map((j) => ({
    key: j.key,
    intervalMs: j.intervalMs,
    jitterMs: j.jitterMs,
    inFlight: j.inFlight,
    hasTimer: Boolean(j.timerId),
  }));
  debugLog("active jobs", snapshot);
  return snapshot;
};

export const pollingCoordinator = { register, stop, stopAll, list: () => [...jobs.keys()] };
