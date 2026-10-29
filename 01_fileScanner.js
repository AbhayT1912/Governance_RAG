import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Directories to ignore
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
]);

/**
 * Supported extensions
 */
const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".go",
  ".cpp",
  ".c",
]);

export function scanCodebase(rootDir) {
  const results = [];

  const baseEntryPath = path.isAbsolute(rootDir)
    ? rootDir
    : path.resolve(__dirname, rootDir);

  function walk(currentPath) {
    let entries;

    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      return; // skip unreadable folders
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(fullPath);
        }
        continue;
      }

      const ext = path.extname(entry.name);

      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }

      if (stats.size > MAX_FILE_SIZE) continue;

      let content;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      results.push({
        path: path.relative(baseEntryPath, fullPath).split(path.sep).join("/"),
        content,
        extension: ext,
      });
    }
  }

  walk(baseEntryPath);

  return results;
}