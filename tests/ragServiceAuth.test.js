import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedRagRequest } from "../ragServiceAuth.js";

const token = "a-production-service-token-with-more-than-32-characters";

test("RAG service auth accepts the configured bearer token", () => {
  assert.equal(isAuthorizedRagRequest(`Bearer ${token}`, token), true);
});

test("RAG service auth rejects missing, malformed, and incorrect credentials", () => {
  assert.equal(isAuthorizedRagRequest(undefined, token), false);
  assert.equal(isAuthorizedRagRequest(token, token), false);
  assert.equal(isAuthorizedRagRequest("Bearer wrong-token", token), false);
});
