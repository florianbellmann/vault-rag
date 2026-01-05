import chalkModule from "chalk";

const DEBUG_ENABLED =
  process.env.DEBUG === "1" ||
  process.env.DEBUG === "true" ||
  process.env.DEBUG === "yes";

type ChalkColorizer = (message: string) => string;

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
  info: (...messages: unknown[]) =>
    log("INFO", chalkModule.cyan, console.log, messages),
  warn: (...messages: unknown[]) =>
    log("WARN", chalkModule.yellow, console.warn, messages),
  error: (...messages: unknown[]) =>
    log("ERROR", chalkModule.red, console.error, messages),
  debug: (...messages: unknown[]) => {
    if (!DEBUG_ENABLED) return;
    log("DEBUG", chalkModule.magenta, console.debug, messages);
  },
};

export { chalkModule as chalk };
