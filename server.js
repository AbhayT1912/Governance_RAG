import express from "express";
import { ingestProject } from "./ingestData.js";
import { askQuestion } from "./ask.js";
import { indexGovernanceResults } from "./06_vectorStore.js";
import { requireRagServiceAuth } from "./ragServiceAuth.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  console.info("RAG request", {
    method: req.method,
    path: req.path,
    agentId: req.get("x-repolens-agent-id") || null,
    jobId: req.get("x-repolens-job-id") || null,
  });
  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "OK", service: "repolens-rag" });
});

// Keep model, vector-store, and ingestion operations private to the backend.
app.use(requireRagServiceAuth);

app.post("/ingest", async (req, res) => {
  const { repoPath, repoUrl, repo_url: repoUrlSnake, repoId } = req.body;

  try {
    if (!repoId || typeof repoId !== "string" || repoId.trim() === "") {
      return res.status(400).json({
        success: false,
        error: "A non-empty repoId is required",
      });
    }

    if (
      (!repoPath || typeof repoPath !== "string" || repoPath.trim() === "") &&
      (!repoUrl || typeof repoUrl !== "string" || repoUrl.trim() === "") &&
      (!repoUrlSnake ||
        typeof repoUrlSnake !== "string" ||
        repoUrlSnake.trim() === "")
    ) {
      return res.status(400).json({
        success: false,
        error: "Provide either repoPath or repoUrl for ingestion",
      });
    }

    const result = await ingestProject({
      repoPath,
      repoUrl: repoUrl || repoUrlSnake,
      repoId,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/ask", async (req, res) => {
  try {
    const { repoId, question } = req.body;

    if (
      typeof repoId !== "string" ||
      repoId.trim() === "" ||
      typeof question !== "string" ||
      question.trim() === ""
    ) {
      return res.status(400).json({
        success: false,
        error: "repoId and non-empty question are required",
      });
    }

    const jobId = req.get("x-repolens-job-id");
    const agentId = req.get("x-repolens-agent-id");
    const conversationKey = jobId && agentId ? `${repoId}:${jobId}:${agentId}` : repoId;
    const result = await askQuestion(repoId, question, conversationKey);

    res.json({
      success: true,
      answer: result.answer,
      retrieval: result.retrieval,
      injectionWarnings: result.injectionWarnings || [],
      usage: result.usage || {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
      },
    });
  } catch (err) {
    console.error("Ask endpoint failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/governance/index", async (req, res) => {
  try {
    const { repoId, jobId, findings, decisions, replace } = req.body || {};
    if (typeof repoId !== "string" || !repoId.trim() || typeof jobId !== "string" || !jobId.trim()) {
      return res.status(400).json({ success: false, error: "repoId and jobId are required" });
    }
    if (!Array.isArray(findings) || findings.length > 5000 || !Array.isArray(decisions) || decisions.length > 1000) {
      return res.status(400).json({ success: false, error: "findings and decisions must be bounded arrays" });
    }
    const result = await indexGovernanceResults({ repoId, jobId, findings, decisions, replace: replace === true });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("Governance indexing failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/health", (req,res) => {
  return res.status(200).json({message: `Server is healthy`});
});

const port = Number(process.env.PORT || 8000);
app.listen(port, "0.0.0.0", () => {
  console.log(`GraphRAG service running on port ${port}`);
});
