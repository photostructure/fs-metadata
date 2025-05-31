#!/usr/bin/env -S npx tsx

import { debugLogContext, isDebugEnabled } from "../debuglog";

try {
  const result = {
    isDebugEnabled: isDebugEnabled(),
    debugLogContext: debugLogContext(),
  };
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
