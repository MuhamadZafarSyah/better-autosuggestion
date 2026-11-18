"use strict";

const vscode = require("vscode");
const { RuntimeWrapper } = require("./runtimeWrapper");
const { applyPatchAll, restorePatchAll, getStatusAll } = require("./corePatcher");

let runtimeWrapper = null;
let statusBarItem = null;
let outputChannel = null;

function createLogger() {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Better Autosuggestion");
  }
  return {
    log(msg) {
      const ts = new Date().toISOString().slice(11, 23);
      outputChannel.appendLine(`[${ts}] ${msg}`);
    },
    show() {
      outputChannel.show(true);
    },
  };
}

function updateStatusBar() {
  if (!statusBarItem) return;
  const cfg = vscode.workspace.getConfiguration("betterAutosuggestion");
  const enabled = cfg.get("enabled", true);
  const statuses = getStatusAll(vscode.env.appRoot);
  const allPatched = statuses.length > 0 && statuses.every((s) => s.patched);
  const stats = runtimeWrapper ? runtimeWrapper.stats : { attached: false, diffsNormalized: 0 };

  if (!enabled) {
    statusBarItem.text = "$(circle-slash) AutoSuggest: Off";
    statusBarItem.tooltip = "Better Autosuggestion is disabled. Click to configure.";
    return;
  }

  const modeLabel = allPatched && stats.attached
    ? "Fixed (Dual)"
    : allPatched
    ? "Fixed (Core)"
    : stats.attached
    ? "Fixed (Wrapper)"
    : "Standby";

  statusBarItem.text = `$(sparkle) AutoSuggest: ${modeLabel}`;
  statusBarItem.tooltip =
    `Better Autosuggestion Active\n` +
    `- Runtime Wrapper: ${stats.attached ? "Attached" : "Not attached"}\n` +
    `- Core Patch: ${allPatched ? "Applied" : "Unpatched"}\n` +
    `- Completions Normalized: ${stats.diffsNormalized || 0}\n` +
    `Click for options & diagnostics`;
}

async function activate(context) {
  const logger = createLogger();
  logger.log("Activating Better Autosuggestion for Antigravity IDE...");

  runtimeWrapper = new RuntimeWrapper(logger);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "better-autosuggestion.status";
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  const cfg = vscode.workspace.getConfiguration("betterAutosuggestion");
  if (cfg.get("autoPatchCoreExtension", true)) {
    const results = applyPatchAll(vscode.env.appRoot);
    for (const r of results) {
      logger.log(`[CorePatcher] ${r.action}: ${r.path}`);
    }
  }

  await runtimeWrapper.attach();
  updateStatusBar();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("betterAutosuggestion")) {
        updateStatusBar();
      }
    }),
    vscode.commands.registerCommand("better-autosuggestion.toggle", async () => {
      const currentCfg = vscode.workspace.getConfiguration("betterAutosuggestion");
      const next = !currentCfg.get("enabled", true);
      await currentCfg.update("enabled", next, vscode.ConfigurationTarget.Global);
      updateStatusBar();
      vscode.window.showInformationMessage(
        `Better Autosuggestion is now ${next ? "Enabled" : "Disabled"}.`
      );
    }),
    vscode.commands.registerCommand("better-autosuggestion.applyPatch", async () => {
      const results = applyPatchAll(vscode.env.appRoot);
      for (const r of results) {
        logger.log(`[CorePatcher] Manual apply -> ${r.action}: ${r.path}`);
      }
      updateStatusBar();
      const newlyPatched = results.some((r) => r.action === "patched");
      if (newlyPatched) {
        const choice = await vscode.window.showInformationMessage(
          "Better Autosuggestion core patch applied to Antigravity. Reload window to activate core changes?",
          "Reload Window"
        );
        if (choice === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } else {
        vscode.window.showInformationMessage(
          "Better Autosuggestion core patch is already active on all detected Antigravity installations."
        );
      }
    }),
    vscode.commands.registerCommand("better-autosuggestion.restorePatch", async () => {
      const results = restorePatchAll(vscode.env.appRoot);
      for (const r of results) {
        logger.log(`[CorePatcher] Restore -> ${r.action}: ${r.path}`);
      }
      updateStatusBar();
      const restored = results.some((r) => r.action === "restored");
      if (restored) {
        const choice = await vscode.window.showInformationMessage(
          "Original Antigravity extension restored from backup. Reload window to apply?",
          "Reload Window"
        );
        if (choice === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } else {
        vscode.window.showWarningMessage("No backup file found to restore.");
      }
    }),
    vscode.commands.registerCommand("better-autosuggestion.status", async () => {
      updateStatusBar();
      const statuses = getStatusAll(vscode.env.appRoot);
      const stats = runtimeWrapper ? runtimeWrapper.stats : {};
      const cfgNow = vscode.workspace.getConfiguration("betterAutosuggestion");
      const enabled = cfgNow.get("enabled", true);

      const items = [
        {
          label: enabled ? "$(circle-slash) Disable Better Autosuggestion" : "$(check) Enable Better Autosuggestion",
          description: `Currently ${enabled ? "Enabled" : "Disabled"}`,
          action: "toggle",
        },
        {
          label: "$(wrench) Apply / Verify Core Patch",
          description: statuses.every((s) => s.patched)
            ? `Patched across ${statuses.length} installation(s)`
            : "Click to patch agy/dist/extension.js",
          action: "applyPatch",
        },
        {
          label: "$(history) Restore Original Antigravity Extension",
          description: "Revert agy/dist/extension.js from backup",
          action: "restorePatch",
        },
        {
          label: "$(output) Open Diagnostics Output Log",
          description: `Streams: ${stats.streamsIntercepted || 0} | Normalized: ${stats.diffsNormalized || 0} | CRLF chars fixed: ${stats.crlfCharsCorrected || 0}`,
          action: "showLog",
        },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Better Autosuggestion — Status & Actions",
      });
      if (!picked) return;
      if (picked.action === "toggle") {
        vscode.commands.executeCommand("better-autosuggestion.toggle");
      } else if (picked.action === "applyPatch") {
        vscode.commands.executeCommand("better-autosuggestion.applyPatch");
      } else if (picked.action === "restorePatch") {
        vscode.commands.executeCommand("better-autosuggestion.restorePatch");
      } else if (picked.action === "showLog") {
        logger.log("=== Status Report ===");
        logger.log(`RuntimeWrapper: ${JSON.stringify(stats)}`);
        for (const s of statuses) {
          logger.log(`Target: ${s.path} | patched=${s.patched} | hasBackup=${s.hasBackup}`);
        }
        logger.show();
      }
    })
  );
}

function deactivate() {
  if (runtimeWrapper) {
    runtimeWrapper.detach();
  }
}

module.exports = { activate, deactivate };

