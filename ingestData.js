import { resolveRepositorySource } from "./00_repoSource.js";
import { scanCodebase } from "./01_fileScanner.js";
import { detectLanguages } from "./02_languageDetector.js";
import { parseFilesToAST } from "./03_astParser.js";
import { extractSymbols } from "./04_symbolExtractor.js";
import { buildChunks } from "./05_chunkBuilder.js";
import { clearRepoChunks, storeChunks } from "./06_vectorStore.js";
import { clearRepoGraph, syncChunksToGraph } from "./07_graphStore.js";

function scopeChunkMetadata(chunk, repoId) {
  const { metadata } = chunk;
  const scopedId = `${repoId}::${metadata.id}`;
  const scopedParentId = metadata.parentId
    ? `${repoId}::${metadata.parentId}`
    : null;

  return {
    ...chunk,
    metadata: {
      ...metadata,
      id: scopedId,
      parentId: scopedParentId,
      repoId,
    },
  };
}

export async function ingestProject({ repoPath, repoUrl, repoId }) {
  if (!repoId || typeof repoId !== "string" || repoId.trim().length === 0) {
    throw new Error("A non-empty repoId is required for ingestion");
  }

  const source = await resolveRepositorySource({ repoPath, repoUrl, repoId });

  try {
    console.log(`Using ${source.source} source for ingestion...`);

    console.log("Scanning files...");
    const files = await scanCodebase(source.folderPath);

    if (files.length === 0) {
      throw new Error("No supported source files were found during scanning");
    }

    console.log("Detecting languages...");
    const withLang = await detectLanguages(files);

    console.log("Parsing AST...");
    const withAst = await parseFilesToAST(withLang);

    console.log("Extracting symbols...");
    const withSymbols = extractSymbols(withAst);

    console.log("Building chunks...");
    const chunks = buildChunks(withSymbols).map((chunk) =>
      scopeChunkMetadata(chunk, repoId),
    );
    console.log(`Total chunks created: ${chunks.length}`);

    if (chunks.length === 0) {
      throw new Error("Chunk builder produced zero chunks");
    }

    console.log("Clearing previous repo data...");
    await clearRepoChunks(repoId);
    await clearRepoGraph(repoId);

    console.log("Storing chunks in Vector DB...");
    const vectorStats = await storeChunks(chunks);

    console.log("Syncing chunks to Knowledge Graph...");
    const graphStats = await syncChunksToGraph(chunks, withSymbols);

    console.log("Ingestion completed successfully.");

    return {
      success: true,
      source: source.source,
      fileCount: files.length,
      chunkCount: chunks.length,
      storedVectors: vectorStats.storedVectors,
      graph: graphStats,
    };
  } finally {
    await source.cleanup();
  }
}
