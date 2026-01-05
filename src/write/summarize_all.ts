import { resolveWritablePath } from "./writeback";
import { iterMarkdownFiles } from "../index/util";
import { logger, chalk } from "../logger";
import { execSync } from "node:child_process";

async function main() {
  const dirArg = process.argv[2];
  if (!dirArg) {
    logger.error(
      "Usage: bun run src/write/summarize_all.ts <relative-or-absolute-dir>",
    );
    process.exit(2);
  }

  const directoryPath = resolveWritablePath(dirArg);
  logger.info(chalk.cyan(`Summarizing all notes under: ${directoryPath}`));

  let count = 0;
  for await (const filePath of iterMarkdownFiles(directoryPath)) {
    count++;
    logger.info(chalk.dim(`Summarizing note ${count}: ${filePath}`));
    try {
      execSync(`bun run summarize "${filePath}"`, { stdio: "inherit" });
    } catch (error) {
      logger.error(`Failed to summarize ${filePath}`, error);
    }
  }
  logger.info(chalk.green(`Processed ${count} note(s).`));
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
