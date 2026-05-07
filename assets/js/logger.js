const DEBUG = typeof localStorage !== "undefined" && localStorage.getItem("nearify_debug") === "1";

export const logger = {
  log:   (...args) => { if (DEBUG) console.log(...args); },
  warn:  (...args) => { if (DEBUG) console.warn(...args); },
  error: (...args) => console.error(...args),
};
