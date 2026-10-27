// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
const SECRET_VALUE = /(["']?)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|(?:access|refresh|id|auth)[_-]?token|client[_-]?secret|private[_-]?key|authorization|cookie|set-cookie|session[_-]?(?:id|token))\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi;

export function redactSecrets(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(authorization\s*:\s*)(?:bearer|basic)\s+[^\s"',;]+/gi, "$1[REDACTED_AUTH]")
    .replace(SECRET_VALUE, (_match, quote, name, separator, secret) => {
      const valueQuote = /^["']/.test(secret) ? secret[0] : "";
      return `${quote}${name}${quote}${separator}${valueQuote}[REDACTED]${valueQuote}`;
    })
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED_USER]:[REDACTED]@")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]");
}
