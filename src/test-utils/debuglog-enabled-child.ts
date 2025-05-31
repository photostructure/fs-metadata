#!/usr/bin/env -S npx tsx

import { debug } from "../debuglog";

// This will be run with NODE_DEBUG set, so debug should be enabled
debug("test message %s %d", "hello", 42);
debug("simple message");
debug("object %o", { key: "value" });

// Signal successful completion
console.log("DONE");
process.exit(0);
