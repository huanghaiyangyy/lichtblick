import { Time } from "@lichtblick/rostime";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: Time;
  level: LogLevel;
  message: string;
  args?: unknown[];
}

type LogSubscriber = (entry: LogEntry) => void;

class DebugLoggerClass {
  private logs: LogEntry[] = [];
  private subscribers: LogSubscriber[] = [];

  public debug(message: string, ...args: unknown[]): void {
    this.addEntry("debug", message, args);
  }

  public info(message: string, ...args: unknown[]): void {
    this.addEntry("info", message, args);
  }

  public warn(message: string, ...args: unknown[]): void {
    this.addEntry("warn", message, args);
  }

  public error(message: string, ...args: unknown[]): void {
    this.addEntry("error", message, args);
  }

  public clear(): void {
    this.logs = [];
  }

  public getAllLogs(): LogEntry[] {
    return [...this.logs];
  }

  public subscribe(callback: LogSubscriber): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(sub => sub !== callback);
    };
  }

  private addEntry(level: LogLevel, message: string, args: unknown[] = []): void {
    const entry: LogEntry = {
      timestamp: { sec: Date.now() / 1000, nsec: 0 },
      level,
      message,
      args: args.length > 0 ? args : undefined,
    };

    this.logs.push(entry);

    this.subscribers.forEach(subscriber => subscriber(entry));

    console[level](message, ...args);
  }
}

export const DebugLogger = new DebugLoggerClass();
