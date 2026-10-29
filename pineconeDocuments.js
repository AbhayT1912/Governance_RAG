export function getDocumentTextField(fields) {
  if (!fields) return null;
  if (fields.chunk_text?.type === "string" && (fields.chunk_text.embed || fields.chunk_text.fullTextSearch)) return "chunk_text";
  return Object.entries(fields).find(([name, field]) =>
    name !== "title" && field?.type === "string" && (field.embed || field.fullTextSearch),
  )?.[0] || null;
}

export function toPineconeDocument(chunk, textField, fields) {
  const metadata = {};
  for (const [key, value] of Object.entries(chunk.metadata || {})) {
    if (value !== null && value !== undefined && typeof value !== "object") metadata[key] = value;
    else if (Array.isArray(value)) metadata[key] = value;
  }
  const { id, ...properties } = metadata;
  const document = {
    _id: String(id || chunk.metadata?.id),
    [textField]: chunk.text,
    ...properties,
  };
  if (fields.title?.type === "string") document.title = metadata.file || document._id;
  return document;
}

export function fromPineconeDocument(match, textField) {
  const { _id, _score, [textField]: text, ...metadata } = match;
  return { ...metadata, id: _id, text, score: _score };
}

export async function searchDocumentsUntilVisible(search, request, options = {}) {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 500;
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let result;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    result = await search(request);
    if (result.matches?.length || attempt === attempts - 1) break;
    await wait(delayMs * (attempt + 1));
  }
  return result;
}
