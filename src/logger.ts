import chalkModule from "chalk";
import type { LogLevel } from "./core/types";

type ChalkColorizer = (message: string) => string;
const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
let currentLevel: LogLevel = "info";

function formatMessage(
  levelLabel: string,
  colorize: ChalkColorizer,
  messages: unknown[],
): string {
  const timestamp = chalkModule.dim(new Date().toISOString());
  const level = colorize(levelLabel.padEnd(5));
  const body = messages
    .map((part) =>
      part instanceof Error ? (part.stack ?? part.message) : String(part),
    )
    .join(" ");
  return `${timestamp} ${level} ${body}`;
}

function log(
  levelLabel: string,
  colorize: ChalkColorizer,
  consoleMethod: (message?: unknown, ...optionalParams: unknown[]) => void,
  messages: unknown[],
) {
  consoleMethod(formatMessage(levelLabel, colorize, messages));
}

export const logger = {
  info: (...messages: unknown[]) => {
    if (levelPriority[currentLevel] > levelPriority.info) return;
    log("INFO", chalkModule.cyan, console.log, messages);
  },
  warn: (...messages: unknown[]) => {
    if (levelPriority[currentLevel] > levelPriority.warn) return;
    log("WARN", chalkModule.yellow, console.warn, messages);
  },
  error: (...messages: unknown[]) =>
    log("ERROR", chalkModule.red, console.error, messages),
  debug: (...messages: unknown[]) => {
    if (levelPriority[currentLevel] > levelPriority.debug) return;
    log("DEBUG", chalkModule.magenta, console.debug, messages);
  },
};

export { chalkModule as chalk };

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}
