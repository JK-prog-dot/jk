// Shared image effects: colour keying and doodle (cartoon) style.
// Works on ImageData-like objects ({ data: Uint8ClampedArray, width, height }).
(function (root) {
  // Make pixels close to a colour transparent (used for video backgrounds).
  function key(data, color, tol) {
    for (let i = 0; i < data.length; i += 4) {
      const dr = data[i] - color[0];
      const dg = data[i + 1] - color[1];
      const db = data[i + 2] - color[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) <= tol) data[i + 3] = 0;
    }
  }

  // 3x3 box blur on RGB that ignores fully transparent pixels.
  function blurRGB(data, w, h) {
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        if (data[p + 3] === 0) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = (yy * w + xx) * 4;
            if (data[q + 3] === 0) continue;
            r += data[q]; g += data[q + 1]; b += data[q + 2]; n++;
          }
        }
        out[p] = r / n; out[p + 1] = g / n; out[p + 2] = b / n; out[p + 3] = data[p + 3];
      }
    }
    return out;
  }

  // Turn a picture into a flat-colour doodle with dark outlines.
  // opt.levels: colour levels per channel (2 to 8), opt.line: outline strength (0 to 100)
  function doodle(img, w, h, opt) {
    const levels = Math.max(2, Math.min(8, (opt && opt.levels) || 5));
    const line = opt && opt.line != null ? opt.line : 55;
    const thr = 320 - line * 2.8;
    const data = img.data;
    const sm = blurRGB(blurRGB(data, w, h), w, h);

    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = 0.3 * sm[p] + 0.59 * sm[p + 1] + 0.11 * sm[p + 2];
    }

    const edge = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] === 0) continue;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        if (Math.sqrt(gx * gx + gy * gy) > thr) edge[i] = 1;
      }
    }

    // Outline around the cut-out shape.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] === 0) continue;
        const open =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          data[(i - 1) * 4 + 3] === 0 || data[(i + 1) * 4 + 3] === 0 ||
          data[(i - w) * 4 + 3] === 0 || data[(i + w) * 4 + 3] === 0;
        if (open) edge[i] = 1;
      }
    }

    const step = 255 / (levels - 1);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (data[p + 3] === 0) continue;
      if (edge[i]) {
        data[p] = 26; data[p + 1] = 26; data[p + 2] = 46; data[p + 3] = 255;
        continue;
      }
      // Keep the hue and flatten only the brightness into a few steps (cel shading).
      const r = sm[p], g = sm[p + 1], b = sm[p + 2];
      const m = Math.max(r, g, b);
      const f = m === 0 ? 0 : (Math.round(m / step) * step) / m;
      data[p] = Math.min(255, r * f); data[p + 1] = Math.min(255, g * f); data[p + 2] = Math.min(255, b * f); data[p + 3] = 255;
    }
  }

  const fx = { key, doodle };
  if (typeof module !== 'undefined' && module.exports) module.exports = fx;
  else root.BuddyFx = fx;
})(typeof window !== 'undefined' ? window : globalThis);
