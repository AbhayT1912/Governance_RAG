import { buildContext } from "./08_queryEngine.js";
import { generateAnswer } from "./09_llmResponder.js";

const historyByRepo = new Map();

export async function askQuestion(repoId, question, conversationKey = repoId) {
  const history = historyByRepo.get(conversationKey) || [];
  const context = await buildContext(repoId, question);

  const result = await generateAnswer(context, history);

  historyByRepo.set(conversationKey, result.updatedHistory);

  return {
    answer: result.answer,
    usage: result.usage,
    injectionWarnings: context.injectionWarnings || [],
    retrieval: {
      snippetCount: context.context.length,
      graphRelationshipCount: context.context.reduce(
        (total, entry) => total + entry.graphContext.length,
        0,
      ),
      sources: context.context.map(({ metadata }) => metadata),
    },
  };
}
