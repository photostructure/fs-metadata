import { debugLogContext, isDebugEnabled } from "../debuglog";

try {
  const result = {
    isDebugEnabled: isDebugEnabled(),
    debugLogContext: debugLogContext(),
  };
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  // Don't log the error object directly as it might have circular references
  // that cause issues with Jest's message passing on Windows
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error(`Error in debuglog-child: ${errorMessage}`);
  process.exit(1);
}
