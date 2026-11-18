"use strict";

const vscode = require("vscode");
const { normalizeCharacterDiff, EOL_CRLF } = require("./diffNormalizer");

const WRAPPED_SYMBOL = Symbol.for("betterAutosuggestion.wrappedClient");

class RuntimeWrapper {
  constructor(logger) {
    this.logger = logger;
    this.client = null;
    this.originalHandleStreamingCommand = null;
    this.stats = {
      attached: false,
      streamsIntercepted: 0,
      diffsNormalized: 0,
      crlfCharsCorrected: 0,
      affixesSimplified: 0,
    };
  }

  getConfig() {
    const cfg = vscode.workspace.getConfiguration("betterAutosuggestion");
    return {
      enabled: cfg.get("enabled", true),
      fixCrlfDrift: cfg.get("fixCrlfDrift", true),
      preferNativeGhostText: cfg.get("preferNativeGhostText", true),
      allowMidLineMultiline: cfg.get("allowMidLineMultiline", true),
      debugLogging: cfg.get("debugLogging", false),
    };
  }

  async attach() {
    if (this.stats.attached && this.client) {
      return true;
    }

    const agyExt = vscode.extensions.getExtension("google.google-antigravity");
    if (!agyExt) {
      this.logger.log("[RuntimeWrapper] Built-in google.google-antigravity extension not found.");
      return false;
    }

    let api;
    try {
      api = agyExt.isActive ? agyExt.exports : await agyExt.activate();
    } catch (err) {
      this.logger.log(`[RuntimeWrapper] Failed to activate google.google-antigravity: ${err.message}`);
      return false;
    }

    const client = api && api.client;
    if (!client || typeof client.handleStreamingCommand !== "function") {
      this.logger.log("[RuntimeWrapper] AntigravityServerClient (api.client) is not available.");
      return false;
    }

    if (client[WRAPPED_SYMBOL]) {
      this.client = client;
      this.stats.attached = true;
      return true;
    }

    const origHandleStreaming = client.handleStreamingCommand.bind(client);
    this.originalHandleStreamingCommand = origHandleStreaming;
    this.client = client;
    const self = this;

    client.handleStreamingCommand = async function* (request, options) {
      const cfg = self.getConfig();
      if (!cfg.enabled) {
        yield* origHandleStreaming(request, options);
        return;
      }

      self.stats.streamsIntercepted++;
      const activeEditor = vscode.window.activeTextEditor;
      const reqLineEnding = request && request.document && request.document.lineEnding;
      const isCrlf =
        reqLineEnding === "\r\n" ||
        Boolean(activeEditor && activeEditor.document.eol === EOL_CRLF);

      for await (const response of origHandleStreaming(request, options)) {
        if (response && response.characterDiff) {
          const res = normalizeCharacterDiff(response.characterDiff, isCrlf, {
            fixCrlfDrift: cfg.fixCrlfDrift,
            preferNativeGhostText: cfg.preferNativeGhostText,
          });
          if (res.modified) {
            self.stats.diffsNormalized++;
            self.stats.crlfCharsCorrected += res.crlfFixedCount;
            if (res.affixSimplified) {
              self.stats.affixesSimplified++;
            }
            if (cfg.debugLogging) {
              self.logger.log(
                `[RuntimeWrapper] Normalized completion=${response.completionId || "n/a"} | ` +
                  `crlfShiftFixed=${res.crlfFixedCount} chars | affixSimplified=${res.affixSimplified}`
              );
            }
          }
        }
        yield response;
      }
    };

    client[WRAPPED_SYMBOL] = true;
    this.stats.attached = true;
    this.logger.log("[RuntimeWrapper] Successfully attached to AntigravityServerClient (api.client).");
    return true;
  }

  detach() {
    if (this.client && this.originalHandleStreamingCommand) {
      this.client.handleStreamingCommand = this.originalHandleStreamingCommand;
      delete this.client[WRAPPED_SYMBOL];
    }
    this.stats.attached = false;
    this.logger.log("[RuntimeWrapper] Detached from AntigravityServerClient.");
  }
}

module.exports = { RuntimeWrapper };

