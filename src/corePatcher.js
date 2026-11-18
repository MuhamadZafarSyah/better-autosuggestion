"use strict";

const fs = require("fs");
const path = require("path");

const PATCH_MARKER = "/*__BETTER_AUTOSUGGESTION_PATCH_V1__*/";

const TARGET_M275 =
  'V.getEdits=function(E,V,R){const l=[],A=Math.max(0,Math.min(V,Math.max(0,E.lineCount-1)));let Z=E.offsetAt(new c.Position(A,0)),e=[],X=[];const N=()=>{if(0===e.length&&0===X.length)return;const V=e.reduce((E,V)=>E+V.text.length,0),R=E.positionAt(Z-V),A=E.positionAt(Z),b=new c.TextEdit(new c.Range(R,A),X.map(E=>E.text).join(""));l.push(b),e=[],X=[]};for(const E of R.changes){const V=E.type;V===b.DiffChangeType.UNCHANGED?(N(),Z+=E.text.length):V===b.DiffChangeType.INSERT?X.push(E):V===b.DiffChangeType.DELETE&&(e.push(E),Z+=E.text.length)}return N(),l}';

const REPLACEMENT_M275 =
  PATCH_MARKER +
  'V.getEdits=function(E,V,R){const l=[],A=Math.max(0,Math.min(V,Math.max(0,E.lineCount-1))),W=t=>E.eol===c.EndOfLine.CRLF&&t.includes("\\n")?t.replace(/\\r?\\n/g,"\\r\\n"):t;let Z=E.offsetAt(new c.Position(A,0)),e=[],X=[];const N=()=>{if(0===e.length&&0===X.length)return;let d=e.join(""),i=X.join(""),p=0,s=0;while(p<d.length&&p<i.length&&d.charCodeAt(p)===i.charCodeAt(p))p++;while(s<d.length-p&&s<i.length-p&&d.charCodeAt(d.length-1-s)===i.charCodeAt(i.length-1-s))s++;const R=E.positionAt(Z-d.length+p),A=E.positionAt(Z-s),T=i.slice(p,i.length-s);(!R.isEqual(A)||T.length>0)&&l.push(new c.TextEdit(new c.Range(R,A),T)),e=[],X=[]};for(const E of R.changes){const V=E.type,t=W(E.text||"");V===b.DiffChangeType.UNCHANGED?(N(),Z+=t.length):V===b.DiffChangeType.INSERT?X.push(t):V===b.DiffChangeType.DELETE&&(e.push(t),Z+=t.length)}return N(),l}';

const TARGET_M7015 =
  'if(U=(0,d.getEdits)(E,R,X.characterDiff),1===U.length&&U[0].range.isEmpty&&U[0].range.start.isEqual(V)){const E=U[0].newText;if(0===E.length)return;const V=new c.InlineCompletionItem(E,U[0].range);return V.command={title:"Accept Completion",command:"antigravity.acceptCompletion",arguments:[X.completionId]},[V]}';

const REPLACEMENT_M7015 =
  'if(U=(0,d.getEdits)(E,R,X.characterDiff),U.length>0&&U.every(u=>u.range.start.line===V.line&&u.range.end.line===V.line)&&U[0].range.start.character>=V.character){const L=E.lineAt(V.line).range.end;let P=V,T="";for(const u of U){if(u.range.start.character<P.character){T="";break}T+=E.getText(new c.Range(P,u.range.start))+u.newText,P=u.range.end}if(T.length>0){T.includes("\\n")&&P.character<L.character&&(T+=E.getText(new c.Range(P,L)),P=L);const I=new c.InlineCompletionItem(T,new c.Range(V,P));return I.command={title:"Accept Completion",command:"antigravity.acceptCompletion",arguments:[X.completionId]},[I]}}';

function discoverTargetPaths(vscodeAppRoot) {
  const candidates = new Set();

  if (vscodeAppRoot) {
    candidates.add(
      path.join(vscodeAppRoot, "extensions", "agy", "dist", "extension.js"),
    );
    const parentRoot = path.resolve(vscodeAppRoot, "..", "..");
    candidates.add(
      path.join(
        parentRoot,
        "resources",
        "app",
        "extensions",
        "agy",
        "dist",
        "extension.js",
      ),
    );
    candidates.add(
      path.join(
        parentRoot,
        "_",
        "resources",
        "app",
        "extensions",
        "agy",
        "dist",
        "extension.js",
      ),
    );
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    for (const dirName of ["Antigravity IDE", "Antigravity"]) {
      const base = path.join(localAppData, "Programs", dirName);
      candidates.add(
        path.join(
          base,
          "resources",
          "app",
          "extensions",
          "agy",
          "dist",
          "extension.js",
        ),
      );
      candidates.add(
        path.join(
          base,
          "_",
          "resources",
          "app",
          "extensions",
          "agy",
          "dist",
          "extension.js",
        ),
      );
    }
  }

  return [...candidates].filter((p) => fs.existsSync(p));
}

function getBackupPath(targetPath) {
  return `${targetPath}.better-backup`;
}

function inspectTarget(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return {
      path: targetPath,
      exists: false,
      patched: false,
      patchable: false,
      hasBackup: false,
    };
  }
  const content = fs.readFileSync(targetPath, "utf8");
  const patched = content.includes(PATCH_MARKER);
  const patchable =
    patched ||
    (content.includes(TARGET_M275) && content.includes(TARGET_M7015));
  const hasBackup = fs.existsSync(getBackupPath(targetPath));
  return { path: targetPath, exists: true, patched, patchable, hasBackup };
}

function applyPatchToFile(targetPath) {
  const status = inspectTarget(targetPath);
  if (!status.exists) {
    return { path: targetPath, ok: false, action: "missing" };
  }
  if (status.patched) {
    return { path: targetPath, ok: true, action: "already_patched" };
  }
  if (!status.patchable) {
    return { path: targetPath, ok: false, action: "pattern_not_found" };
  }

  const content = fs.readFileSync(targetPath, "utf8");
  const backupPath = getBackupPath(targetPath);
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, content, "utf8");
  }

  const patchedContent = content
    .replace(TARGET_M275, REPLACEMENT_M275)
    .replace(TARGET_M7015, REPLACEMENT_M7015);

  fs.writeFileSync(targetPath, patchedContent, "utf8");
  return { path: targetPath, ok: true, action: "patched", backupPath };
}

function restoreFileFromBackup(targetPath) {
  const backupPath = getBackupPath(targetPath);
  if (!fs.existsSync(backupPath)) {
    return { path: targetPath, ok: false, action: "no_backup" };
  }
  const original = fs.readFileSync(backupPath, "utf8");
  fs.writeFileSync(targetPath, original, "utf8");
  return { path: targetPath, ok: true, action: "restored" };
}

function applyPatchAll(vscodeAppRoot) {
  const paths = discoverTargetPaths(vscodeAppRoot);
  return paths.map((p) => applyPatchToFile(p));
}

function restorePatchAll(vscodeAppRoot) {
  const paths = discoverTargetPaths(vscodeAppRoot);
  return paths.map((p) => restoreFileFromBackup(p));
}

function getStatusAll(vscodeAppRoot) {
  const paths = discoverTargetPaths(vscodeAppRoot);
  return paths.map((p) => inspectTarget(p));
}

module.exports = {
  PATCH_MARKER,
  TARGET_M275,
  REPLACEMENT_M275,
  TARGET_M7015,
  REPLACEMENT_M7015,
  discoverTargetPaths,
  inspectTarget,
  applyPatchToFile,
  restoreFileFromBackup,
  applyPatchAll,
  restorePatchAll,
  getStatusAll,
};
