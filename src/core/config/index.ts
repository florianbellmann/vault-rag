import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { GlobalConfig, LogLevel } from "../types";

let cachedConfig: GlobalConfig | null = null;

/**
 * Loads and caches the global configuration so every module follows a single source of truth.
 *
 * The loader consults the `RAG_CONFIG_PATH` environment variable first. When unset, it defaults
 * to `${process.cwd()}/rag.config.yaml`. Environment variables may override select properties:
 * - `OBSIDIAN_VAULT` overrides `paths.vault`
 * - `RAG_DB_PATH` overrides `paths.database`
 *
 * @throws When the configuration file cannot be read or parsed.
 */
export function loadConfig(): GlobalConfig {
  if (cachedConfig) return cachedConfig;
  const configPath =
    process.env.RAG_CONFIG_PATH ?? resolve(process.cwd(), "rag.config.yaml");
  if (!existsSync(configPath)) {
    const examplePath = `${configPath}.example`;
    if (existsSync(examplePath)) {
      throw new Error(
        `Missing ${configPath}. Copy ${examplePath} to ${configPath} and customize it.`,
      );
    }
    throw new Error(`Missing configuration file at ${configPath}`);
  }
  const fileContents = readFileSync(configPath, "utf8");
  const parsed = parse(fileContents) as GlobalConfig;
  const envVault = process.env.OBSIDIAN_VAULT;
  const envDb = process.env.RAG_DB_PATH ?? process.env.DB_PATH;
  const envLogLevel = process.env.RAG_LOG_LEVEL;
  parsed.paths.vault = envVault ?? parsed.paths.vault;
  parsed.paths.database = envDb ?? parsed.paths.database;
  parsed.paths.log_level = normalizeLogLevel(
    (envLogLevel as string | undefined) ?? parsed.paths.log_level,
  );
  cachedConfig = parsed;
  return parsed;
}

/**
 * Resets the configuration cache. Primarily used by tests to ensure isolation.
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

function normalizeLogLevel(level: string | LogLevel): LogLevel {
  const normalized = String(level).toLowerCase();
  if (normalized === "debug") return "debug";
  if (normalized === "warn") return "warn";
  if (normalized === "error") return "error";
  return "info";
}
