import type { LogLevel } from "../core/types";

interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const LOG_BUFFER_LIMIT = 500;

export class Logger {
  private static globalLevel: LogLevel = "info";
  private static entries: LogEntry[] = [];
  private scope: string;

  constructor(scope: string) {
    this.scope = scope;
  }

  static setGlobalLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  static exportLogs(): string {
    return Logger.entries
      .map((entry) => JSON.stringify(entry))
      .join("\n");
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[Logger.globalLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      scope: this.scope,
      message,
      context,
      timestamp: new Date().toISOString()
    };

    Logger.entries.push(entry);
    if (Logger.entries.length > LOG_BUFFER_LIMIT) {
      Logger.entries.shift();
    }

    const payload = `[Ink2Markdown:${entry.scope}] ${entry.timestamp} ${entry.message}`;
    if (level === "error") {
      console.error(payload, entry.context ?? {});
      return;
    }
    if (level === "warn") {
      console.warn(payload, entry.context ?? {});
      return;
    }
    if (level === "info") {
      console.info(payload, entry.context ?? {});
      return;
    }
    console.debug(payload, entry.context ?? {});
  }
}
