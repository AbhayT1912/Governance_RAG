const UNTRUSTED_INSTRUCTION_PATTERNS = [
  /\bignore (?:all )?(?:previous|prior) (?:instructions|rules)\b/i,
  /\b(?:reveal|print|exfiltrate) (?:the )?(?:system prompt|secrets|credentials)\b/i,
  /\byou are now (?:an? )?(?:admin|system|developer)\b/i,
  /\bdisregard (?:the )?(?:rules|policy|system prompt)\b/i,
];

export function sanitizeRepositoryText(text) {
  const warnings = [];
  const safeText = String(text || "").split(/\r?\n/).filter((line) => {
    const untrusted = UNTRUSTED_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(line));
    if (untrusted) warnings.push(line);
    return !untrusted;
  }).join("\n");
  return { safeText, warnings };
}
