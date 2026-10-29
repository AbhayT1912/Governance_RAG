import "dotenv/config";
import { Pinecone } from "@pinecone-database/pinecone";
import { GoogleGenerativeAI } from "@google/generative-ai";

/* ===============================
   Init Gemini + Pinecone
================================ */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const INDEX_NAME = process.env.PINECONE_INDEX || "hackathon-index";

/* ===============================
   EMBEDDING FUNCTION (STABLE)
================================ */

async function embedText(text) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    console.error("❌ EMPTY OR INVALID TEXT PASSED TO EMBEDDING:", text);
    throw new Error("Invalid text passed to embedding");
  }

  try {
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("Embedding failed:", error);
    throw error;
  }
}

/* ===============================
   Metadata Sanitization
================================ */

function sanitizeMetadata(metadata) {
  const clean = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    clean[key] = value;
  }

  return clean;
}

function getIndex() {
  return pc.index(INDEX_NAME);
}

export async function clearRepoChunks(repoId) {
  if (!repoId || typeof repoId !== "string" || repoId.trim().length === 0) {
    throw new Error("A non-empty repoId is required to clear repo chunks");
  }

  await getIndex().deleteMany({
    filter: {
      repoId: { $eq: repoId },
    },
  });

  console.log(`Cleared existing Pinecone records for repoId=${repoId}`);
}

/* ===============================
   Store Chunks
================================ */

export async function storeChunks(chunks) {
  if (!chunks?.length) {
    throw new Error("No chunks were provided for vector storage");
  }

  const index = getIndex();

  console.log(`Embedding ${chunks.length} chunks...`);
  const EMBED_BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || 50);
  if (!Number.isInteger(EMBED_BATCH_SIZE) || EMBED_BATCH_SIZE < 1) {
    throw new Error("EMBED_BATCH_SIZE must be a positive integer");
  }

  let storedVectors = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const chunkBatch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const result = await embeddingModel.batchEmbedContents({
      requests: chunkBatch.map((chunk) => ({
        content: { parts: [{ text: chunk.text }] },
      })),
    });

    if (
      !result.embeddings ||
      result.embeddings.length !== chunkBatch.length
    ) {
      throw new Error(
        `Embedding batch at index ${i} returned ${result.embeddings?.length || 0} embeddings for ${chunkBatch.length} chunks`,
      );
    }

    const vectorBatch = result.embeddings.map((embedding, idx) => {
      const chunk = chunkBatch[idx];
      if (!embedding.values?.length) {
        throw new Error(`Embedding for chunk ${chunk.metadata.id} is empty`);
      }

      return {
        id: String(chunk.metadata.id),
        values: embedding.values,
        metadata: sanitizeMetadata({
          ...chunk.metadata,
          text: chunk.text,
        }),
      };
    });

    const upsertResult = await index.upsert({ records: vectorBatch });
    if (upsertResult.upsertedCount !== vectorBatch.length) {
      throw new Error(
        `Pinecone accepted ${upsertResult.upsertedCount ?? 0} of ${vectorBatch.length} vectors in batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1}`,
      );
    }
    storedVectors += upsertResult.upsertedCount;

    console.log(
      `Upserted batch ${Math.floor(i / EMBED_BATCH_SIZE) + 1} with ${vectorBatch.length} vectors.`,
    );
  }

  if (storedVectors !== chunks.length) {
    throw new Error(
      `Stored ${storedVectors} vectors for ${chunks.length} chunks`,
    );
  }

  console.log(
    `All batches upserted successfully. Stored ${storedVectors} vectors.`,
  );

  return {
    storedVectors,
  };
}

export async function indexGovernanceResults({ repoId, jobId, findings = [], decisions = [], replace = false }) {
  if (!repoId || !jobId || !Array.isArray(findings) || !Array.isArray(decisions)) {
    throw new Error("repoId, jobId, findings, and decisions are required");
  }
  if (findings.some((item) => !item?.id || !item.category || !item.target || !item.claim || !Array.isArray(item.evidence)) ||
      decisions.some((item) => !item?.id || !item.category || !item.target || !item.status)) {
    throw new Error("Every finding and decision must include its required identifiers and content");
  }
  if (replace === true) {
    await getIndex().deleteMany({
      filter: {
        repoId: { $eq: repoId },
        jobId: { $eq: jobId },
        type: { $in: ["governance_finding", "governance_decision"] },
      },
    });
  }
  const chunks = [
    ...findings.map((finding) => ({
      text: [
        `Governance finding: ${finding.category} at ${finding.target}.`,
        finding.claim,
        `Risk score: ${finding.riskScore}; confidence: ${finding.confidence}.`,
        `Evidence: ${(finding.evidence || []).map((item) => `${item.kind}:${item.ref}`).join(", ")}`,
      ].join("\n"),
      metadata: {
        id: `${repoId}::governance::${jobId}::finding::${finding.id}`,
        parentId: null,
        repoId,
        jobId,
        file: `Governance Findings/${finding.category}`,
        sourceFile: (finding.evidence || []).find((item) => item.kind === "file")?.ref || null,
        findingId: finding.id,
        symbol: finding.target,
        type: "governance_finding",
        language: "text",
      },
    })),
    ...decisions.map((decision) => ({
      text: [
        `Governance decision: ${decision.category} at ${decision.target}.`,
        `Status: ${decision.status}; score: ${decision.score}; agreement: ${decision.agreement}.`,
        `Supporting findings: ${(decision.findingIds || []).join(", ")}.`,
        `Dissenting findings: ${(decision.dissentIds || []).join(", ")}.`,
      ].join("\n"),
      metadata: {
        id: `${repoId}::governance::${jobId}::decision::${decision.id}`,
        parentId: null,
        repoId,
        jobId,
        file: `Governance Decisions/${decision.category}`,
        symbol: decision.target,
        type: "governance_decision",
        language: "text",
        findingIds: decision.findingIds || [],
      },
    })),
  ];
  if (chunks.length === 0) return { storedVectors: 0 };
  return storeChunks(chunks);
}

/* ===============================
   Semantic Search
================================ */

export async function semanticSearch(query, repoId, topK = 10) {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    console.error("❌ INVALID QUERY PASSED TO semanticSearch:", query);
    throw new Error("Invalid query for semantic search");
  }

  if (!repoId || typeof repoId !== "string" || repoId.trim().length === 0) {
    throw new Error("Invalid repoId for semantic search");
  }

  const index = pc.index(INDEX_NAME);

  const embedding = await embedText(query);

  const result = await index.query({
    vector: embedding,
    topK,
    includeMetadata: true,
    filter: {
      repoId: { $eq: repoId },
    },
  });

  return (result.matches || []).map(match => match.metadata);
}
