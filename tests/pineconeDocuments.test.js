import test from "node:test";
import assert from "node:assert/strict";
import {
  fromPineconeDocument,
  getDocumentTextField,
  searchDocumentsUntilVisible,
  toPineconeDocument,
} from "../pineconeDocuments.js";

test("detects an integrated-embedding document field and maps chunks to schema fields", () => {
  const fields = {
    title: { type: "string", fullTextSearch: {} },
    chunk_text: { type: "string", embed: { model: "llama-text-embed-v2" } },
  };
  assert.equal(getDocumentTextField(fields), "chunk_text");

  const document = toPineconeDocument({
    text: "function login() {}",
    metadata: { id: "repo::chunk-1", file: "auth.ts", repoId: "repo", parentId: null },
  }, "chunk_text", fields);

  assert.deepEqual(document, {
    _id: "repo::chunk-1",
    chunk_text: "function login() {}",
    file: "auth.ts",
    repoId: "repo",
    title: "auth.ts",
  });
});

test("retries an empty document search while Pinecone makes a fresh write searchable", async () => {
  let calls = 0;
  const result = await searchDocumentsUntilVisible(async () => {
    calls += 1;
    return calls < 3 ? { matches: [] } : { matches: [{ _id: 'new-doc' }] };
  }, {}, { delayMs: 1, wait: async () => {} });

  assert.equal(calls, 3);
  assert.equal(result.matches[0]._id, 'new-doc');
});

test("maps document search matches back to the context shape used by the RAG prompt", () => {
  assert.deepEqual(fromPineconeDocument({
    _id: "repo::chunk-1",
    _score: 0.92,
    chunk_text: "safe code",
    repoId: "repo",
    file: "auth.ts",
  }, "chunk_text"), {
    id: "repo::chunk-1",
    score: 0.92,
    text: "safe code",
    repoId: "repo",
    file: "auth.ts",
  });
});
