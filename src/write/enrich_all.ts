import { execSync } from "node:child_process";
import { iterMarkdownFiles } from "../index/util";
import { chalk, logger } from "../logger";
import { resolveWritablePath } from "./writeback";

async function main() {
  const dirArg = process.argv[2];
  if (!dirArg) {
    logger.error(
      "Usage: bun run src/write/enrich_all.ts <relative-or-absolute-dir>",
    );
    process.exit(2);
  }

  const directoryPath = resolveWritablePath(dirArg);
  logger.info(chalk.cyan(`Enriching all notes under: ${directoryPath}`));

  let count = 0;
  for await (const filePath of iterMarkdownFiles(directoryPath)) {
    count++;
    logger.info(chalk.dim(`Enriching note ${count}: ${filePath}`));
    try {
      execSync(`bun run enrich "${filePath}"`, { stdio: "inherit" });
    } catch (error) {
      logger.error(`Failed to enrich ${filePath}`, error);
    }
  }
  logger.info(chalk.green(`Processed ${count} note(s).`));
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
