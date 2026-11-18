# Better Autosuggestion for Antigravity

[![Open VSX](https://img.shields.io/badge/Open%20VSX-Registry-blue)](https://open-vsx.org/extension/zafarsyah/better-autosuggestion)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Better Autosuggestion** fixes the autocomplete ghost text positioning regressions in Antigravity IDE (e.g. gray suggestion text appearing mid-identifier or shifted columns to the left) while continuing to use **100% of Antigravity's integrated AI engine** (`AntigravityServerClient` / `agy.exe`).

---

## 🔍 The Problem It Solves

In Antigravity IDE, when typing statements like:
```javascript
const currentYear = ;
```
with your cursor positioned right before the semicolon (`|;`), the built-in autocomplete sometimes shifts the suggestion 5+ characters to the left, inserting `2026` right into the identifier:
```javascript
// ❌ Bug: Ghost text appears inside the variable name
const currentYe2026ar = ;
```

Accepting via **Tab** inserts the code at the wrong position, and subsequent suggestions compound the error.

### Root Causes
1. **CRLF vs. LF Offset Mismatch**: On Windows systems, editor document offsets treat newlines as 2 characters (`\r\n`), while the language model server's `characterDiff` calculates edits with 1-character newlines (`\n`). Each preceding line shifts the insertion point further left.
2. **Ghost Text vs. Inline Diff Coalescing**: Antigravity falls back to inline diff blocks instead of native VS Code ghost text (`InlineCompletionItem`) when minor character deletions (like trailing `;` or `)`) occur.

---

## ✨ Features

- **Zero Collision & Native AI**: Does **NOT** spawn separate AI models or duplicate token usage. It acts as an intelligent precision layer over Antigravity's native language service.
- **CRLF Offset Normalization**: Accurately maps document positions between `\r\n` and `\n`, eliminating left-shifting ghost text.
- **Clean Single-Line Ghost Text**: Automatically coalesces trailing punctuation replacements into native ghost text right at your cursor.
- **Dual-Layer Architecture**:
  - **Layer 1 (Runtime Interceptor)**: Wraps `agy.client.handleStreamingCommand` in-memory with zero disk footprint.
  - **Layer 2 (Core Patcher)**: Optional automatic patch for Antigravity's core module (`agy/dist/extension.js`) with one-click rollback and `.better-backup` safety.

---

## 🚀 Getting Started

1. Install **Better Autosuggestion** from the Extensions view.
2. Reload Antigravity IDE (`Ctrl+Shift+P` -> `Developer: Reload Window`).
3. Check the status bar in the bottom right corner:
   - `$(sparkle) AutoSuggest: Fixed` indicates active protection.

---

## ⚙️ Configuration

You can customize behavior in Settings (`Ctrl+,` -> search `Better Autosuggestion`):

| Setting | Default | Description |
|---|---|---|
| `betterAutosuggestion.enabled` | `true` | Master switch to enable/disable the wrapper. |
| `betterAutosuggestion.fixCrlfDrift` | `true` | Corrects newline offset drift on Windows. |
| `betterAutosuggestion.preferNativeGhostText` | `true` | Coalesces inline replacements into native ghost text. |
| `betterAutosuggestion.autoPatchCoreExtension`| `true` | Automatically applies the core patch to Antigravity's internal extension. |
| `betterAutosuggestion.debugLogging` | `false` | Outputs detailed before/after diff telemetry to Output channel. |

---

## ⌨️ Commands

- `Better Autosuggestion: Show Status & Diagnostics`
- `Better Autosuggestion: Apply Core Patch to Antigravity`
- `Better Autosuggestion: Restore Original Antigravity Extension`
- `Better Autosuggestion: Toggle Enable/Disable`

---

## 📄 License

MIT © [Muhamad Zafar Syah](https://github.com/zafarsyah)

