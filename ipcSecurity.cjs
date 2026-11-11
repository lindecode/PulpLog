// Copyright (c) 2026 LindeCode S.A.S. SPDX-License-Identifier: MIT
function isTrustedSender(event, allowedContents, appUrl) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!sender || !allowedContents.has(sender) || sender.isDestroyed() || !frame || frame !== sender.mainFrame) return false;
  try {
    const source = new URL(frame.url);
    source.hash = "";
    return normalizeDriveLetter(source.href) === normalizeDriveLetter(new URL(appUrl).href);
  } catch { return false; }
}

// Chromium reports "file:///V:/…" while Node's pathToFileURL keeps the drive
// letter as given ("file:///v:/…"); only that letter is made case-insensitive.
function normalizeDriveLetter(href) {
  return href.replace(/^file:\/\/\/([a-zA-Z]):\//, (_m, drive) => `file:///${drive.toUpperCase()}:/`);
}

function assertStreamOwner(stream, sender) {
  if (stream && stream.sender !== sender) throw new Error("Stream belongs to another window");
}

module.exports = { isTrustedSender, assertStreamOwner };
