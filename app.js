import createMseVerifierModule from "./mse_verifier.js";

const fileInput = document.getElementById("media_file");
const mimeInput = document.getElementById("mime_type");
const fileSummary = document.getElementById("file_summary");
const outputView = document.getElementById("output");

let wasmModule = null;
let loadedBytes = null;

function formatByteCount(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function runVerification() {
  if (!wasmModule || !loadedBytes) {
    return;
  }

  const byteLen = loadedBytes.byteLength;
  const dataPtr = byteLen > 0 ? wasmModule._malloc(byteLen) : 0;
  if (byteLen > 0 && !dataPtr) {
    outputView.classList.remove("valid");
    outputView.classList.add("error");
    outputView.textContent = JSON.stringify(
      { ok: false, error: `Failed to allocate ${byteLen} bytes in WASM heap.` },
      null,
      2
    );
    return;
  }

  const mimeStr = mimeInput.value.trim();
  const mimeBytes = wasmModule.lengthBytesUTF8(mimeStr) + 1;
  const mimePtr = wasmModule._malloc(mimeBytes);

  try {
    if (byteLen > 0) {
      wasmModule.HEAPU8.set(loadedBytes, dataPtr);
    }
    wasmModule.stringToUTF8(mimeStr, mimePtr, mimeBytes);

    const resPtr = wasmModule._VerifyMseMedia(dataPtr, byteLen, mimePtr);
    if (!resPtr) {
      outputView.classList.remove("valid");
      outputView.classList.add("error");
      outputView.textContent = "{}";
      return;
    }

    const raw = wasmModule.UTF8ToString(resPtr);
    wasmModule._FreeMseVerifierResult(resPtr);

    const parsed = JSON.parse(raw);
    const isOk = parsed && parsed.ok === true;
    outputView.classList.toggle("valid", isOk);
    outputView.classList.toggle("error", !isOk);
    outputView.textContent = raw;
  } catch (err) {
    outputView.classList.remove("valid");
    outputView.classList.add("error");
    outputView.textContent = JSON.stringify(
      { ok: false, wasm_exception: String(err) },
      null,
      2
    );
  } finally {
    if (dataPtr) {
      wasmModule._free(dataPtr);
    }
    if (mimePtr) {
      wasmModule._free(mimePtr);
    }
  }
}

async function loadFiles(fileList) {
  if (!fileList || fileList.length === 0) {
    return;
  }
  const files = Array.from(fileList);
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
  const totalBytes = buffers.reduce((acc, b) => acc + b.byteLength, 0);

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  loadedBytes = combined;
  const names = files.map((f) => f.name).join(" + ");
  fileSummary.textContent = `${names} (${formatByteCount(totalBytes)})`;
  runVerification();
}

fileInput.addEventListener("change", () => {
  loadFiles(fileInput.files);
});

mimeInput.addEventListener("input", () => {
  runVerification();
});

window.addEventListener("dragover", (e) => {
  e.preventDefault();
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    loadFiles(e.dataTransfer.files);
  }
});

createMseVerifierModule()
  .then((mod) => {
    wasmModule = mod;
    if (loadedBytes) {
      runVerification();
    } else {
      outputView.textContent =
        "Select or drop one or more media files (e.g. fMP4, init.mp4 + seg.m4s, WebM, MPEG-2 TS, ADTS AAC, or MP3) to inspect with Chromium's MSE StreamParser.";
    }
  })
  .catch((err) => {
    outputView.classList.add("error");
    outputView.textContent = `Failed to load WASM module: ${err}`;
  });
