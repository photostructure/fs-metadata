import { debugLogContext, isDebugEnabled } from "../debuglog";

// Ensure clean process state on Windows
process.on("uncaughtException", (err) => {
  const errorMessage = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `Uncaught exception in debuglog-child: ${errorMessage}\n`,
  );
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const errorMessage =
    reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(
    `Unhandled rejection in debuglog-child: ${errorMessage}\n`,
  );
  process.exit(1);
});

try {
  const result = {
    isDebugEnabled: isDebugEnabled(),
    debugLogContext: debugLogContext(),
  };
  // Use process.stdout.write to ensure clean output
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  // Don't log the error object directly as it might have circular references
  // that cause issues with Jest's message passing on Windows
  const errorMessage = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error in debuglog-child: ${errorMessage}\n`);

  // Also log stack trace for debugging
  if (err instanceof Error && err.stack) {
    process.stderr.write(`Stack trace:\n${err.stack}\n`);
  }

  process.exit(1);
}
