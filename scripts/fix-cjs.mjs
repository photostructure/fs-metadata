import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function fixCjsFiles(dir) {
  const files = await readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = join(dir, file.name);

    if (file.isDirectory()) {
      await fixCjsFiles(fullPath);
      continue;
    }

    // First read and fix content
    if (file.name.endsWith(".js") || file.name.endsWith(".cjs")) {
      const content = await readFile(fullPath, "utf8");
      const fixedContent = content.replace(
        /require\("(.+?)\.js"\)/gm,
        'require("$1.cjs")',
      );

      // Write fixed content to .cjs file
      const newPath = fullPath.replace(/\.js$/, ".cjs");
      await writeFile(newPath, fixedContent);

      // Remove old .js file if it exists
      if (newPath !== fullPath) {
        await unlink(fullPath);
      }
    }
  }
}

await fixCjsFiles("./dist/cjs");
