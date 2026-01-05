import { execSync } from "node:child_process";
import { chalk, logger } from "../logger";
import { resolveWritablePath } from "./writeback";

async function main() {
  const targetArg = process.argv[2];
  if (!targetArg) {
    logger.error(
      "Usage: bun run src/write/enrich_note.ts <relative-or-absolute-path>",
    );
    process.exit(2);
  }

  const absolutePath = resolveWritablePath(targetArg);
  logger.info(chalk.cyan(`Enriching note: ${absolutePath}`));

  const tasks = [
    { label: "summary", command: `bun run summarize "${absolutePath}"` },
    { label: "tags", command: `bun run tag "${absolutePath}"` },
    { label: "related", command: `bun run related "${absolutePath}"` },
  ];

  for (const task of tasks) {
    logger.info(chalk.dim(`Running ${task.label}...`));
    try {
      execSync(task.command, { stdio: "inherit" });
    } catch (error) {
      logger.error(`Failed to run ${task.label} for ${absolutePath}`, error);
    }
  }

  logger.info(chalk.green(`Finished enriching ${absolutePath}`));
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
