import { debug } from "../debuglog";

// Ensure clean process state on Windows
process.on("uncaughtException", (err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `Uncaught exception in debuglog-enabled-child: ${errorMessage}\n`,
  );
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const errorMessage =
    reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(
    `Unhandled rejection in debuglog-enabled-child: ${errorMessage}\n`,
  );
  process.exit(1);
});

try {
  // This will be run with NODE_DEBUG set, so debug should be enabled
  debug("test message %s %d", "hello", 42);
  debug("simple message");
  debug("object %o", { key: "value" });

  // Signal successful completion using stdout.write for clean output
  process.stdout.write("DONE");
  process.exit(0);
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error in debuglog-enabled-child: ${errorMessage}\n`);

  // Also log stack trace for debugging
  if (err instanceof Error && err.stack) {
    process.stderr.write(`Stack trace:\n${err.stack}\n`);
  }

  process.exit(1);
}
