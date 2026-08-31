import { isTauri } from "@tauri-apps/api/core";
import {
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  warn as tauriWarn,
} from "@tauri-apps/plugin-log";

type LogContext = Readonly<Record<string, unknown>>;

function formatMessage(event: string, context?: LogContext): string {
  if (!context) {
    return event;
  }

  try {
    return `${event} ${JSON.stringify(context)}`;
  } catch {
    return `${event} {"context":"unserializable"}`;
  }
}

async function write(
  level: "debug" | "info" | "warn" | "error",
  event: string,
  context?: LogContext,
): Promise<void> {
  const message = formatMessage(event, context);

  if (isTauri()) {
    const writers = {
      debug: tauriDebug,
      info: tauriInfo,
      warn: tauriWarn,
      error: tauriError,
    } as const;
    await writers[level](message);
    return;
  }

  const writers = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  } as const;
  writers[level](message);
}

export const logger = {
  debug: (event: string, context?: LogContext) =>
    write("debug", event, context),
  info: (event: string, context?: LogContext) =>
    write("info", event, context),
  warn: (event: string, context?: LogContext) =>
    write("warn", event, context),
  error: (event: string, context?: LogContext) =>
    write("error", event, context),
};
