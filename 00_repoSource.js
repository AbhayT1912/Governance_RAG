import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

const CLONE_TIMEOUT_MS = Number(process.env.CLONE_TIMEOUT_MS || 120000);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isReadableDirectory(candidatePath) {
  if (!isNonEmptyString(candidatePath)) {
    return false;
  }

  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeRepoId(repoId) {
  return String(repoId || "repo").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function cloneRepository(repoUrl, targetDir) {
  return new Promise((resolve, reject) => {
    const git = spawn("git", ["clone", "--depth", "1", repoUrl, targetDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      git.kill("SIGKILL");
      reject(new Error(`git clone timed out after ${CLONE_TIMEOUT_MS}ms`));
    }, CLONE_TIMEOUT_MS);

    git.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    git.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    git.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    git.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutHandle);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `git clone exited with code ${code}`,
        ),
      );
    });
  });
}

export async function resolveRepositorySource({ repoPath, repoUrl, repoId }) {
  if (isReadableDirectory(repoPath)) {
    return {
      folderPath: repoPath,
      source: "repoPath",
      cleanup: async () => {},
    };
  }

  if (!isNonEmptyString(repoUrl)) {
    throw new Error(
      "Ingestion requires either a readable repoPath or a repoUrl that can be cloned",
    );
  }

  const tempRoot = path.join(os.tmpdir(), "codelens-rag");
  fs.mkdirSync(tempRoot, { recursive: true });

  const targetDir = fs.mkdtempSync(
    path.join(tempRoot, `${sanitizeRepoId(repoId)}-`),
  );

  try {
    await cloneRepository(repoUrl, targetDir);
  } catch (error) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw error;
  }

  return {
    folderPath: targetDir,
    source: "repoUrl",
    cleanup: async () => {
      fs.rmSync(targetDir, { recursive: true, force: true });
    },
  };
}
