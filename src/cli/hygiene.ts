import { analyzeVault } from "../core/augmentation/hygiene";
import { loadConfig } from "../core/config";
import { logger, setLogLevel } from "../logger";

async function main() {
  const config = loadConfig();
  setLogLevel(config.paths.log_level);
  const issues = await analyzeVault(config);
  if (issues.length === 0) {
    logger.info("Vault hygiene: no issues detected.");
    return;
  }
  logger.warn(`Vault hygiene: ${issues.length} issues detected.`);
  for (const issue of issues) {
    logger.warn(`[${issue.type}] ${issue.path} -> ${issue.detail}`);
  }
}

main().catch((error) => {
  logger.error("Hygiene analysis failed:", error);
  process.exit(1);
});
