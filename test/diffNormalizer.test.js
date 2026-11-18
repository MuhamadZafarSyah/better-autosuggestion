"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DIFF_UNCHANGED,
  DIFF_INSERT,
  DIFF_DELETE,
  EOL_CRLF,
  normalizeCharacterDiff,
  computeEdits,
  coalesceCursorLineCompletion,
} = require("../src/diffNormalizer");
const {
  inspectTarget,
  discoverTargetPaths,
  TARGET_M275,
  REPLACEMENT_M275,
  TARGET_M7015,
  REPLACEMENT_M7015,
} = require("../src/corePatcher");

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
  get isEmpty() {
    return this.start.isEqual(this.end);
  }
}

class TextEdit {
  constructor(range, newText) {
    this.range = range;
    this.newText = newText;
  }
}

const mockVscode = { Position, Range, TextEdit, EndOfLine: { LF: 1, CRLF: 2 } };

function createMockDocument(lines, eol = EOL_CRLF) {
  const sep = eol === EOL_CRLF ? "\r\n" : "\n";
  const fullText = lines.join(sep);

  const lineOffsets = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + sep.length);
  }

  return {
    eol,
    lineCount: lines.length,
    lineAt(line) {
      const text = lines[line];
      return {
        text,
        range: new Range(new Position(line, 0), new Position(line, text.length)),
      };
    },
    offsetAt(pos) {
      return lineOffsets[pos.line] + pos.character;
    },
    positionAt(offset) {
      const clamped = Math.max(0, Math.min(offset, fullText.length));
      for (let i = lineOffsets.length - 1; i >= 0; i--) {
        if (clamped >= lineOffsets[i]) {
          const col = Math.min(lines[i].length, clamped - lineOffsets[i]);
          return new Position(i, col);
        }
      }
      return new Position(0, 0);
    },
    getText(range) {
      if (!range) return fullText;
      const start = this.offsetAt(range.start);
      const end = this.offsetAt(range.end);
      return fullText.slice(start, end);
    },
  };
}

test("Case 1: Fixes CRLF 5-character left-shift on `const currentYear = |;` (the exact screenshot bug)", () => {
  const lines = [
    "// Line 1",
    "// Line 2",
    "// Line 3",
    "// Line 4",
    "// Line 5",
    "const currentYear = ;",
  ];
  const doc = createMockDocument(lines, EOL_CRLF);
  const cursorPos = new Position(5, 20); // right before `;`

  // Server sends characterDiff with LF (\n) newlines starting at selectionStartLine = 0
  const prefixLf = lines.slice(0, 5).join("\n") + "\nconst currentYear = ";
  const rawDiff = {
    changes: [
      { type: DIFF_UNCHANGED, text: prefixLf },
      { type: DIFF_INSERT, text: "2026" },
      { type: DIFF_UNCHANGED, text: ";" },
    ],
  };

  // Demonstrate the original bug: without CRLF normalization, offset is 5 chars short (col 15: between 'Ye' and 'ar')
  const unnormalizedOffset = prefixLf.length;
  const buggyPos = doc.positionAt(unnormalizedOffset);
  assert.equal(buggyPos.line, 5);
  assert.equal(buggyPos.character, 15); // "const currentYe|ar = ;"

  // Now run our CRLF normalizer & computeEdits
  const edits = computeEdits(doc, 0, rawDiff, mockVscode);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].newText, "2026");
  assert.equal(edits[0].range.isEmpty, true);
  assert.equal(edits[0].range.start.line, 5);
  assert.equal(edits[0].range.start.character, 20); // Exactly at cursorPos before `;`!
  assert.equal(edits[0].range.start.isEqual(cursorPos), true);
});

test("Case 2: Simplifies redundant DELETE(';') + INSERT('2026;') into pure cursor insertion", () => {
  const lines = ["const currentYear = ;"];
  const doc = createMockDocument(lines, EOL_CRLF);
  const cursorPos = new Position(0, 20);

  const rawDiff = {
    changes: [
      { type: DIFF_UNCHANGED, text: "const currentYear = " },
      { type: DIFF_DELETE, text: ";" },
      { type: DIFF_INSERT, text: "2026;" },
    ],
  };

  const res = normalizeCharacterDiff(rawDiff, true);
  assert.equal(res.modified, true);
  assert.equal(res.affixSimplified, true);

  const edits = computeEdits(doc, 0, rawDiff, mockVscode);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].newText, "2026");
  assert.equal(edits[0].range.isEmpty, true);
  assert.equal(edits[0].range.start.isEqual(cursorPos), true);
});

test("Case 3: Coalesces multi-edit cursor line completion (e.g. console.log(|) -> console.log('hi');)", () => {
  const lines = ["console.log()"];
  const doc = createMockDocument(lines, EOL_CRLF);
  const cursorPos = new Position(0, 12); // inside `(` and `)`

  const edits = [
    new TextEdit(new Range(new Position(0, 12), new Position(0, 12)), '"hi"'),
    new TextEdit(new Range(new Position(0, 13), new Position(0, 13)), ";"),
  ];

  const coalesced = coalesceCursorLineCompletion(doc, cursorPos, edits, mockVscode);
  assert.ok(coalesced);
  assert.equal(coalesced.insertText, '"hi");');
  assert.equal(coalesced.range.start.character, 12);
  assert.equal(coalesced.range.end.character, 13);
});

test("Case 4: Supports multiline completion when cursor is before closing brace `function f() { | }`", () => {
  const lines = ["function f() { }"];
  const doc = createMockDocument(lines, EOL_CRLF);
  const cursorPos = new Position(0, 15); // right before `}`

  const edits = [
    new TextEdit(new Range(cursorPos, cursorPos), "\n  return 2026;\n"),
  ];

  const coalesced = coalesceCursorLineCompletion(doc, cursorPos, edits, mockVscode);
  assert.ok(coalesced);
  assert.equal(coalesced.insertText, "\n  return 2026;\n}");
  assert.equal(coalesced.range.start.character, 15);
  assert.equal(coalesced.range.end.character, 16);
});

test("Case 5: CorePatcher discovers local Antigravity installations and validates patch syntax", () => {
  const targets = discoverTargetPaths();
  assert.ok(targets.length > 0, "Should discover at least one Antigravity agy/dist/extension.js");
  for (const t of targets) {
    const status = inspectTarget(t);
    assert.equal(status.exists, true);
    assert.equal(status.patchable, true, `Target ${t} should be patchable`);
  }
  // Ensure replacement snippets are valid JS expressions
  new Function("V", "c", "b", "d", "E", "R", "X", REPLACEMENT_M275);
  new Function("U", "d", "E", "R", "X", "V", "c", " { " + REPLACEMENT_M7015 + " }");
});

