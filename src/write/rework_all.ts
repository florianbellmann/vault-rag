import { iterVaultMarkdown } from "../core/fs/vault";
import { chalk, logger } from "../logger";
import { formatDuration } from "../utils/formatDuration";
import { reworkNote } from "./rework_note";
import { resolveWritablePath } from "./writeback";

async function main() {
  const dirArg = process.argv[2];
  if (!dirArg) {
    logger.error(
      "Usage: bun run src/write/rework_all.ts <relative-or-absolute-dir>",
    );
    process.exit(2);
  }

  const directoryPath = resolveWritablePath(dirArg);
  logger.info(chalk.cyan(`Reworking all notes under: ${directoryPath}`));

  const files: string[] = [];
  for await (const file of iterVaultMarkdown(directoryPath)) {
    files.push(file.absolute);
  }

  const totalNotes = files.length;
  const startedAt = Date.now();
  let count = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  for (const filePath of files) {
    count++;
    const noteStartedAt = Date.now();
    logger.info(
      chalk.dim(`Reworking note [${count}/${totalNotes}]: ${filePath}`),
    );
    try {
      const result = await reworkNote(filePath);
      if (result.status === "updated") {
        processed++;
        logger.info(
          chalk.green(
            `Reworked note [${count}/${totalNotes}] in ${formatDuration(
              Date.now() - noteStartedAt,
            )}: ${filePath}`,
          ),
        );
      } else if (result.status === "skipped") {
        skipped++;
        logger.info(
          chalk.dim(
            `Skipped note [${count}/${totalNotes}] in ${formatDuration(
              Date.now() - noteStartedAt,
            )}: ${filePath}`,
          ),
        );
      } else {
        failed++;
        logger.error(
          `Failed to rework [${count}/${totalNotes}] in ${formatDuration(
            Date.now() - noteStartedAt,
          )}: ${filePath} - ${result.message ?? "Unknown error"}`,
        );
      }
    } catch (error) {
      failed++;
      logger.error(
        `Failed to rework [${count}/${totalNotes}] in ${formatDuration(
          Date.now() - noteStartedAt,
        )}: ${filePath}`,
        error,
      );
    }
  }
  logger.info(
    chalk.green(
      `Reworked ${processed} note(s), skipped ${skipped}, failed ${failed}. Total ${formatDuration(
        Date.now() - startedAt,
      )}.`,
    ),
  );
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
