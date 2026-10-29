import { semanticSearch } from "./06_vectorStore.js";
import { expandSymbol } from "./07_graphStore.js";
import { sanitizeRepositoryText } from "./untrustedText.js";

/**
 * Builds a rich, structured context for the LLM by joining
 * Vector results with Graph lineage.
 */
export async function buildContext(repoId, query) {
  if (!repoId || typeof repoId !== "string" || repoId.trim().length === 0) {
    throw new Error("Invalid repoId for context building");
  }

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    console.error("❌ INVALID QUERY PASSED TO buildContext:", query);
    throw new Error("Invalid query for context building");
  }

  const chunks = await semanticSearch(query, repoId, 5);

  const enhancedResults = [];
  const injectionWarnings = [];
  const globalSeenIds = new Set();

  for (const chunk of chunks) {
    const { symbol, file, text, type, language, id } = chunk;

    const sanitized = sanitizeRepositoryText(text);
    if (sanitized.warnings.length) {
      injectionWarnings.push({ file, count: sanitized.warnings.length });
    }
    const resultEntry = {
      code: sanitized.safeText,
      metadata: {
        file, symbol, type, language, id,
        findingId: chunk.findingId,
        findingIds: chunk.findingIds,
        sourceFile: chunk.sourceFile,
        jobId: chunk.jobId,
      },
      graphContext: [],
    };

    try {
      const neighbors = await expandSymbol(id);

      for (const neighbor of neighbors) {
        if (!globalSeenIds.has(neighbor.id)) {
          resultEntry.graphContext.push({
            name: neighbor.name,
            type: neighbor.type,
            id: neighbor.id,
          });
          globalSeenIds.add(neighbor.id);
        }
      }
    } catch (err) {
      console.warn(`Graph expansion skipped for ${id}:`, err.message);
    }

    enhancedResults.push(resultEntry);
  }

  return {
    repoId,
    query,
    context: enhancedResults,
    injectionWarnings,
  };
}
