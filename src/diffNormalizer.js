"use strict";

const DIFF_UNCHANGED = 3;
const DIFF_INSERT = 1;
const DIFF_DELETE = 2;
const EOL_CRLF = 2;

function commonPrefixLength(a, b) {
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen && a.charCodeAt(i) === b.charCodeAt(i)) {
    i++;
  }
  return i;
}

function commonSuffixLength(a, b, prefixLen = 0) {
  const maxSuffix = Math.min(a.length - prefixLen, b.length - prefixLen);
  let i = 0;
  while (
    i < maxSuffix &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++;
  }
  return i;
}

/**
 * Simplifies adjacent DELETE + INSERT groups by factoring out unchanged common prefixes
 * and suffixes into UNCHANGED chunks. This turns redundant replacements like
 * DELETE(";") + INSERT("2026;") into INSERT("2026") + UNCHANGED(";"), allowing
 * native cursor-anchored InlineCompletionItem rendering.
 */
function simplifyDiffAffixes(changes, templateChange) {
  const out = [];
  let modified = false;
  let i = 0;

  const makeChange = (type, text) => {
    if (templateChange && typeof templateChange === "object") {
      const clone = Object.create(Object.getPrototypeOf(templateChange));
      Object.assign(clone, templateChange, { type, text });
      return clone;
    }
    return { type, text };
  };

  while (i < changes.length) {
    const c = changes[i];
    if (!c || (c.type !== DIFF_DELETE && c.type !== DIFF_INSERT)) {
      out.push(c);
      i++;
      continue;
    }

    const groupStart = i;
    let delText = "";
    let insText = "";
    while (
      i < changes.length &&
      changes[i] &&
      (changes[i].type === DIFF_DELETE || changes[i].type === DIFF_INSERT)
    ) {
      if (changes[i].type === DIFF_DELETE) {
        delText += changes[i].text || "";
      } else {
        insText += changes[i].text || "";
      }
      i++;
    }

    if (delText.length > 0 && insText.length > 0) {
      const prefLen = commonPrefixLength(delText, insText);
      const suffLen = commonSuffixLength(delText, insText, prefLen);
      if (prefLen > 0 || suffLen > 0) {
        modified = true;
        const prefix = delText.slice(0, prefLen);
        const delMid = delText.slice(prefLen, delText.length - suffLen);
        const insMid = insText.slice(prefLen, insText.length - suffLen);
        const suffix = suffLen > 0 ? delText.slice(delText.length - suffLen) : "";

        if (prefix) out.push(makeChange(DIFF_UNCHANGED, prefix));
        if (delMid) out.push(makeChange(DIFF_DELETE, delMid));
        if (insMid) out.push(makeChange(DIFF_INSERT, insMid));
        if (suffix) out.push(makeChange(DIFF_UNCHANGED, suffix));
        continue;
      }
    }

    for (let j = groupStart; j < i; j++) {
      out.push(changes[j]);
    }
  }

  return { changes: modified ? out : changes, modified };
}

/**
 * Normalizes line endings inside characterDiff.changes so that UNCHANGED and DELETE
 * chunk lengths match VS Code's TextDocument.offsetAt / positionAt on CRLF documents,
 * and simplifies redundant DELETE+INSERT affixes around the cursor.
 */
function normalizeCharacterDiff(characterDiff, isCrlf, options = {}) {
  if (!characterDiff || !Array.isArray(characterDiff.changes)) {
    return { characterDiff, modified: false, crlfFixedCount: 0, affixSimplified: false };
  }

  const fixCrlf = options.fixCrlfDrift !== false && Boolean(isCrlf);
  const simplifyAffixes = options.preferNativeGhostText !== false;

  let modified = false;
  let crlfFixedCount = 0;

  if (fixCrlf) {
    for (const change of characterDiff.changes) {
      if (!change || typeof change.text !== "string" || !change.text.includes("\n")) {
        continue;
      }
      const normalizedText = change.text.replace(/\r?\n/g, "\r\n");
      if (normalizedText !== change.text) {
        if (change.type === DIFF_UNCHANGED || change.type === DIFF_DELETE) {
          crlfFixedCount += normalizedText.length - change.text.length;
        }
        change.text = normalizedText;
        modified = true;
      }
    }
  }

  let affixSimplified = false;
  if (simplifyAffixes && characterDiff.changes.length > 0) {
    const simplified = simplifyDiffAffixes(
      characterDiff.changes,
      characterDiff.changes[0]
    );
    if (simplified.modified) {
      characterDiff.changes.splice(0, characterDiff.changes.length, ...simplified.changes);
      affixSimplified = true;
      modified = true;
    }
  }

  return {
    characterDiff,
    modified,
    crlfFixedCount,
    affixSimplified,
  };
}

/**
 * Computes TextEdits from characterDiff with CRLF-aware offset calculation.
 * Compatible drop-in replacement for Module 275's getEdits(document, selectionStartLine, characterDiff).
 */
function computeEdits(document, selectionStartLine, characterDiff, vscodeApi) {
  if (!characterDiff || !Array.isArray(characterDiff.changes)) {
    return [];
  }

  const isCrlf = document.eol === EOL_CRLF;
  const edits = [];
  const maxLine = Math.max(0, document.lineCount - 1);
  const startLine = Math.max(0, Math.min(Number(selectionStartLine || 0), maxLine));

  let offset = document.offsetAt(new vscodeApi.Position(startLine, 0));
  let deletes = [];
  let inserts = [];

  const norm = (str) => (isCrlf && str.includes("\n") ? str.replace(/\r?\n/g, "\r\n") : str);

  const flush = () => {
    if (deletes.length === 0 && inserts.length === 0) {
      return;
    }
    const deletedLen = deletes.reduce((sum, d) => sum + d.length, 0);
    const startPos = document.positionAt(offset - deletedLen);
    const endPos = document.positionAt(offset);
    const newText = inserts.join("");
    edits.push(new vscodeApi.TextEdit(new vscodeApi.Range(startPos, endPos), newText));
    deletes = [];
    inserts = [];
  };

  const simplified = simplifyDiffAffixes(characterDiff.changes, null).changes;

  for (const change of simplified) {
    const text = norm(change.text || "");
    if (change.type === DIFF_UNCHANGED) {
      flush();
      offset += text.length;
    } else if (change.type === DIFF_INSERT) {
      inserts.push(text);
    } else if (change.type === DIFF_DELETE) {
      deletes.push(text);
      offset += text.length;
    }
  }
  flush();
  return edits;
}

/**
 * Coalesces edits on the cursor line into a single native VS Code InlineCompletionItem
 * anchored at the cursor position whenever possible, avoiding mispositioned showInlineEdits.
 */
function coalesceCursorLineCompletion(document, cursorPos, edits, vscodeApi, options = {}) {
  const preferNative = options.preferNativeGhostText !== false;
  const allowMidLineMultiline = options.allowMidLineMultiline !== false;

  if (!Array.isArray(edits) || edits.length === 0) {
    return null;
  }

  const isSinglePureAtCursor =
    edits.length === 1 &&
    edits[0].range.isEmpty &&
    edits[0].range.start.line === cursorPos.line &&
    edits[0].range.start.character === cursorPos.character;

  if (!isSinglePureAtCursor && !preferNative) {
    return null;
  }

  const cursorLine = cursorPos.line;
  for (const edit of edits) {
    if (edit.range.start.line !== cursorLine || edit.range.end.line !== cursorLine) {
      return null;
    }
  }

  const normalizedEdits = edits.slice();
  const first = normalizedEdits[0];
  if (first.range.start.character < cursorPos.character) {
    if (first.range.end.character < cursorPos.character) {
      return null;
    }
    const prefixRange = new vscodeApi.Range(first.range.start, cursorPos);
    const prefixText = document.getText(prefixRange);
    if (!first.newText.startsWith(prefixText)) {
      return null;
    }
    normalizedEdits[0] = new vscodeApi.TextEdit(
      new vscodeApi.Range(cursorPos, first.range.end),
      first.newText.slice(prefixText.length)
    );
  }

  let cursor = cursorPos;
  let combinedText = "";
  for (const edit of normalizedEdits) {
    if (edit.range.start.character < cursor.character) {
      return null;
    }
    const gapRange = new vscodeApi.Range(cursor, edit.range.start);
    combinedText += document.getText(gapRange) + edit.newText;
    cursor = edit.range.end;
  }

  let endPos = cursor;
  const lineEndPos = document.lineAt(cursorLine).range.end;

  if (combinedText.includes("\n") && endPos.character < lineEndPos.character) {
    if (!allowMidLineMultiline) {
      return null;
    }
    combinedText += document.getText(new vscodeApi.Range(endPos, lineEndPos));
    endPos = lineEndPos;
  }

  if (!combinedText) {
    return null;
  }

  return {
    insertText: combinedText,
    range: new vscodeApi.Range(cursorPos, endPos),
  };
}

module.exports = {
  DIFF_UNCHANGED,
  DIFF_INSERT,
  DIFF_DELETE,
  EOL_CRLF,
  commonPrefixLength,
  commonSuffixLength,
  simplifyDiffAffixes,
  normalizeCharacterDiff,
  computeEdits,
  coalesceCursorLineCompletion,
};
