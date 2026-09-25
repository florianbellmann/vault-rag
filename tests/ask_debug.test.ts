import { describe, expect, test } from "bun:test";

const RUN_FLAG = process.env.RUN_ASK_DEBUG_TEST === "1";

describe("ask:debug performance", () => {
  const runTest = RUN_FLAG ? test : test.skip;

  runTest("answers within 30 seconds", async () => {
    const start = Date.now();
    const proc = Bun.spawn(
      ["bun", "run", "ask:debug", "what day is it"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OLLAMA_URL: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
        },
      },
    );

    const timeoutMs = 30_000;
    const timeout = setTimeout(() => {
      proc.kill();
    }, timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    const durationMs = Date.now() - start;
    expect(exitCode).toBe(0);
    expect(durationMs).toBeLessThan(timeoutMs);
  });
});
