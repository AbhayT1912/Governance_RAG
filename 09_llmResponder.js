import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Rate limit tracking
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // ms between requests

export function buildPrompt(query, context) {
  if (!context || context.length === 0) {
    return `The user asked: "${query}", but no relevant code was found in the database.`;
  }

  let prompt = `You are provided with the following code snippets and their architectural relationships to answer the user's question: "${query}"\n\n`;

  context.forEach((entry, index) => {
    const { metadata, code, graphContext } = entry;
    prompt += `--- CODE SNIPPET ${index + 1} ---\n`;
    prompt += `LOCATION: ${metadata.file} (Symbol: ${metadata.symbol})\n`;
    prompt += `CONTENT:\n${code}\n`;

    if (graphContext && graphContext.length > 0) {
      prompt += `GRAPH RELATIONSHIPS:\n`;
      graphContext.forEach(rel => {
        prompt += `- This ${metadata.type} is connected to ${rel.name} (${rel.type})\n`;
      });
    }
    prompt += `\n`;
  });

  return prompt;
}

/**
 * Exponential backoff retry with Gemini API rate limit detection
 */
async function generateAnswerWithRetry(userPrompt, history, retries = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Enforce minimum interval between API calls to avoid rate limiting
      const timeSinceLastRequest = Date.now() - lastRequestTime;
      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        await new Promise(resolve => 
          setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
        );
      }

      lastRequestTime = Date.now();

      // Add timeout to prevent hanging requests
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API timeout after 50s")), 50000)
      );

      const response = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          config: {
            systemInstruction: `You are an expert software engineer.
        Only answer questions related to coding or software engineering.
        Answer using ONLY the provided code snippets and graph relationships.
        Be precise and answer step-by-step.
        Keep the answers sufficiently detailed.
        Only provide explanations and not the code or relationships itself.

        In the graph DB, the module refers to a file that is not defined inside another file.

        
        Rules:
1. Only use provided code snippets and graph relationships.
2. If context is insufficient, provide a small desclaimer.
3. Always explain architecture first, then logic flow.
4. Mention file names when relevant.
5. Be technically precise and avoid speculation.
6. Use numbered steps.
7. Keep answer structured.

        IF the provided context is not enough, answer the questions if they are related to software engineering or coding BUT provide a small desclaimer that the context was insufficient so you are answering by yourself.
`,
          },
          contents: [
            ...history,
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
        }),
        timeoutPromise,
      ]);

      // Success
      return response;
    } catch (error) {
      lastError = error;
      const errorMsg = error?.message || error?.toString() || "";
      const isRateLimit = 
        errorMsg.includes("429") || 
        errorMsg.includes("quota") || 
        errorMsg.includes("rate");
      
      console.warn(
        `[Gemini] Attempt ${attempt + 1}/${retries} failed${isRateLimit ? " (rate limited)" : ""}:`,
        errorMsg
      );

      if (attempt < retries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

export async function generateAnswer(context, history = []) {
  try {
    const userPrompt = buildPrompt(context.query, context.context);
    const response = await generateAnswerWithRetry(userPrompt, history);

    const responseText = response.text;
    const usageMetadata = response?.usageMetadata || {};
    const promptTokens = Number(
      usageMetadata.promptTokenCount ?? usageMetadata.inputTokens ?? 0,
    );
    const completionTokens = Number(
      usageMetadata.candidatesTokenCount ?? usageMetadata.outputTokens ?? 0,
    );
    const totalTokens = Number(
      usageMetadata.totalTokenCount ?? promptTokens + completionTokens,
    );
    const usage = {
      totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
      promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
      completionTokens: Number.isFinite(completionTokens)
        ? completionTokens
        : 0,
      model: response?.modelVersion || "gemini-2.5-flash",
    };

    const updatedHistory = [
      ...history,
      { role: "user", parts: [{ text: userPrompt }] },
      { role: "model", parts: [{ text: responseText }] },
    ];

    return {
      answer: responseText,
      updatedHistory: updatedHistory,
      usage,
    };
  } catch (error) {
    console.error("LLM Generation failed:", error.message);
    throw error;
  }
}
