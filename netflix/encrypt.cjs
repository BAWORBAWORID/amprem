#!/usr/bin/env node
// Encrypt (obfuscate) extension scripts with js-confuser.
// Run:  NODE_PATH=$(npm root -g) node netflix/encrypt.cjs
"use strict";

const fs = require("fs");
const path = require("path");

const jsConfuser = require("js-confuser").obfuscate;

const DIR = __dirname;
const FILES = ["background.js", "sidebar.js", "stealth.js"];

// CSP-safe HARD obfuscation for a Manifest V3 extension.
//
// IMPORTANT: the following heavy js-confuser transforms generate runtime
// `eval()`/`new Function(...)` at runtime, which is BLOCKED by:
//   - the extension CSP ("script-src 'self'") for background/content scripts, AND
//   - Netflix's own page CSP for the MAIN-world content script (stealth.js),
// producing: "Refused to evaluate a string as JavaScript because 'unsafe-eval'
// is not an allowed source...". They also inflate the files to megabytes,
// which breaks service-worker registration.
//   - globalConcealing
//   - stringConcealing / stringEncoding / stringSplitting
//   - rgf (random function generation)
//   - astScrambler (adds new Function)
//
// So we keep those OFF and rely on everything else, which is still very hard
// to read (control flow flattening + object extraction + dispatcher + opaque
// predicates + dead code + renaming) while staying eval-free and compact.
const OPTS = {
  target: "browser",
  identifierGenerator: "hexadecimal",
  renameVariables: true,
  renameGlobals: true,
  variableMasking: true,
  duplicateLiteralsRemoval: true,
  objectExtraction: true,
  flatten: true,
  controlFlowFlattening: true,
  dispatcher: true,
  opaquePredicates: true,
  deadCode: true,
  calculator: true,
  movedDeclarations: true,
  // stringEncoding (CSP-safe) - menyembunyikan string penting tanpa eval:
  stringEncoding: true,
  // CSP-unsafe — keep OFF for MV3:
  globalConcealing: false,
  stringConcealing: false,
  stringSplitting: false,
  rgf: false,
  astScrambler: false,
  lock: false,
};

async function main() {
  for (const file of FILES) {
    const src = path.join(DIR, file);
    const bak = path.join(DIR, file + ".orig");
    const raw = fs.readFileSync(src, "utf8");

    // Keep a human-readable backup next to the encrypted file.
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw);

    // Sanity: refuse to encrypt a file that already leaks eval/new Function.
    if (/\beval\(|\bnew\s+Function\b/.test(raw)) {
      console.error(`[!] skip ${file}: output would contain eval/new Function (MV3 CSP block)`);
      continue;
    }

    try {
      const res = await jsConfuser(raw, OPTS);
      let out = typeof res === "string" ? res : res.code;
      if (/\beval\(|\bnew\s+Function\b/.test(out)) {
        console.error(`[!] SKIP WRITE ${file}: encrypted output still contains eval/new Function`);
        continue;
      }
      // Wrap the ENTIRE output in an IIFE. This makes every const/let/var
      // function-scoped, so content scripts can never collide with each other
      // or the host page (else: "Identifier '_0x…' has already been declared").
      // Source files have no top-level await/import/export, so this is safe.
      const wrapped =
        "(()=>{\n\"use strict\";\n" + out.trim() + "\n})();\n";
      const outLen = wrapped.length;
      fs.writeFileSync(src, wrapped);
      console.log(`[+] encrypted ${file}  (${raw.length} -> ${outLen} bytes, wrapped in IIFE)`);
    } catch (e) {
      console.error(`[!] gagal ${file}:`, e.message);
    }
  }
  console.log("[*] selesai. Backup asli disimpan sebagai *.js.orig");
}

main().catch((e) => {
  console.error("[!] encrypt gagal:", e);
  process.exit(1);
});