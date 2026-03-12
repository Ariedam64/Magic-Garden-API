// src/assets/ktx2Decoder.js
//
// Decodes KTX2 textures (UASTC + Zstd) to raw RGBA using the Basis Universal WASM transcoder.
// Returns a Buffer of raw RGBA pixels that can be fed to sharp({ raw: { width, height, channels: 4 } }).

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = resolve(__dirname, "wasm");

let basisModule = null;
let initPromise = null;

/**
 * Load and initialize the Basis Universal WASM transcoder.
 * Cached after first call.
 */
async function ensureBasis() {
  if (basisModule) return basisModule;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const jsPath = resolve(WASM_DIR, "basis_transcoder.js");
    const wasmPath = resolve(WASM_DIR, "basis_transcoder.wasm");

    // basis_transcoder.js is an Emscripten IIFE that assigns to `var BASIS`.
    // It uses require("fs")/require("path") internally for Node.js WASM loading.
    // We run it in a CJS-like sandbox so `require` and `__dirname` are available.
    const require = createRequire(jsPath);
    const code = readFileSync(jsPath, "utf8");
    const wrapper = new Function("require", "__dirname", "__filename", code + "\nreturn BASIS;");
    const factory = wrapper(require, WASM_DIR, jsPath);

    const wasmBinary = readFileSync(wasmPath);
    const mod = await factory({ wasmBinary });
    mod.initializeBasis();

    basisModule = mod;
    return mod;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

/**
 * Decode a KTX2 buffer to raw RGBA pixels.
 *
 * @param {Buffer|Uint8Array} ktx2Buffer - The raw KTX2 file bytes
 * @returns {{ width: number, height: number, rgba: Buffer }} Decoded RGBA data
 */
export async function decodeKTX2(ktx2Buffer) {
  const mod = await ensureBasis();

  const data =
    ktx2Buffer instanceof Uint8Array
      ? ktx2Buffer
      : new Uint8Array(ktx2Buffer.buffer, ktx2Buffer.byteOffset, ktx2Buffer.byteLength);

  const ktx2File = new mod.KTX2File(data);

  if (!ktx2File.isValid()) {
    ktx2File.close();
    ktx2File.delete();
    throw new Error("Invalid KTX2 file");
  }

  const width = ktx2File.getWidth();
  const height = ktx2File.getHeight();

  // cTFRGBA32 = 13
  const RGBA32 = mod.transcoder_texture_format.cTFRGBA32.value;

  if (!ktx2File.startTranscoding()) {
    ktx2File.close();
    ktx2File.delete();
    throw new Error("KTX2 startTranscoding failed");
  }

  // level 0, layer 0, face 0
  const imageSize = ktx2File.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
  const rgba = new Uint8Array(imageSize);

  const ok = ktx2File.transcodeImage(rgba, 0, 0, 0, RGBA32, 0, -1, -1);

  ktx2File.close();
  ktx2File.delete();

  if (!ok) {
    throw new Error("KTX2 transcodeImage failed");
  }

  return {
    width,
    height,
    rgba: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
  };
}

/**
 * Check if a URL or filename points to a KTX2 file.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isKTX2(path) {
  return typeof path === "string" && path.toLowerCase().endsWith(".ktx2");
}
