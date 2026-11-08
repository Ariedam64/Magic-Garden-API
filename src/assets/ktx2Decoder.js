// src/assets/ktx2Decoder.js
//
// Decodes KTX2 textures to raw RGBA: Basis Universal (UASTC + Zstd, up to v1961) through
// the WASM transcoder, BC7 (v1973+, the game's per-GPU-format atlases) through bc7.js.
// Returns a Buffer of raw RGBA pixels that can be fed to sharp({ raw: { width, height, channels: 4 } }).

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBC7 } from "./bc7.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = resolve(__dirname, "wasm");

let basisModule = null;
let initPromise = null;

// Suppress DEP0005 (Buffer() deprecation) triggered by Emscripten's WASM bindings.
// The Emscripten-generated code uses new Buffer() internally and cannot be patched.
const origEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const code = typeof args[0] === "string" ? args[1] : args[0]?.code;
  if (code === "DEP0005") return;
  return origEmitWarning.call(this, warning, ...args);
};

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

const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const VK_FORMAT_UNDEFINED = 0;
const VK_FORMAT_BC7_UNORM_BLOCK = 145;
const VK_FORMAT_BC7_SRGB_BLOCK = 146;

/**
 * En-tête KTX2 et niveau 0 (le plus grand), ou null si ce n'est pas un KTX2.
 */
function readHeader(data) {
  if (data.length < 104 || KTX2_IDENTIFIER.some((b, i) => data[i] !== b)) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    vkFormat: view.getUint32(12, true),
    width: view.getUint32(20, true),
    height: view.getUint32(24, true),
    supercompression: view.getUint32(44, true),
    level0Offset: Number(view.getBigUint64(80, true)),
    level0Length: Number(view.getBigUint64(88, true)),
  };
}

function decodeGpuFormat(data, header) {
  const { vkFormat, width, height, supercompression, level0Offset, level0Length } = header;

  if (vkFormat !== VK_FORMAT_BC7_UNORM_BLOCK && vkFormat !== VK_FORMAT_BC7_SRGB_BLOCK) {
    throw new Error(`Unsupported KTX2 vkFormat ${vkFormat}: only Basis and BC7 can be decoded`);
  }
  if (supercompression !== 0) {
    throw new Error(`Unsupported KTX2 supercompression scheme ${supercompression} for BC7`);
  }

  const blocks = data.subarray(level0Offset, level0Offset + level0Length);
  return { width, height, rgba: decodeBC7(blocks, width, height) };
}

/**
 * Decode a KTX2 buffer to raw RGBA pixels.
 *
 * @param {Buffer|Uint8Array} ktx2Buffer - The raw KTX2 file bytes
 * @returns {{ width: number, height: number, rgba: Buffer }} Decoded RGBA data
 */
export async function decodeKTX2(ktx2Buffer) {
  const data =
    ktx2Buffer instanceof Uint8Array
      ? ktx2Buffer
      : new Uint8Array(ktx2Buffer.buffer, ktx2Buffer.byteOffset, ktx2Buffer.byteLength);

  // vkFormat 0 : données Basis, que seul le transcodeur sait lire. Tout autre
  // format est déjà un format GPU, stocké tel quel dans le fichier.
  const header = readHeader(data);
  if (header && header.vkFormat !== VK_FORMAT_UNDEFINED) return decodeGpuFormat(data, header);

  const mod = await ensureBasis();

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
