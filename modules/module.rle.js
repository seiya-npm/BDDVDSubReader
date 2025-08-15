const decodePGSIndexRLE = (sup, rleBuffer, w, h, strict = true) => {
    const pixels = new Uint8Array(w * h);
    let ptr = 0;
    let pos = 0;

    while (pos < w * h && ptr < rleBuffer.length) {
        let x = pos % w;
        let y = Math.floor(pos / w);

        let code = rleBuffer[ptr++];

        if (code !== 0) {
            pixels[pos++] = code;
            continue;
        }

        code = rleBuffer[ptr++];
        if (code === 0) {
            if (x !== 0) {
                while (x < w && pos < w * h) {
                    pixels[pos++] = 0;
                    x++;
                }
            }
            else {
                pos = y * w;
            }
            continue;
        }

        let length;
        let color = 0;
        const prefix = code >> 6;
        const lowBits = code & 0x3F;

        switch (prefix) {
        case 0:
            length = lowBits;
            color = 0;
            break;
        case 1:
            if (ptr >= rleBuffer.length)
                throw new Error('Incomplete RLE data');
            length = (lowBits << 8) | rleBuffer[ptr++];
            color = 0;
            break;
        case 2:
            if (ptr >= rleBuffer.length)
                throw new Error('Incomplete RLE data');
            length = lowBits;
            color = rleBuffer[ptr++];
            break;
        case 3:
            if (ptr + 1 >= rleBuffer.length)
                throw new Error('Incomplete RLE data');
            length = (lowBits << 8) | rleBuffer[ptr++];
            color = rleBuffer[ptr++];
            break;
        default:
            throw new Error('Invalid RLE prefix');
        }

        for (let i = 0; i < length && pos < w * h; i++) {
            x = pos % w;
            y = Math.floor(pos / w);
            pixels[pos++] = color;
            if (x + 1 >= w && pos < w * h) {
                pos = (y + 1) * w;
            }
        }
    }

    if (pos < w * h) {
        throw new Error(`RLE data incomplete: filled ${pos} of ${w * h} pixels`);
    }

    if (ptr < rleBuffer.length) {
        if (ptr === rleBuffer.length - 2 && rleBuffer[ptr] === 0 && rleBuffer[ptr + 1] === 0) {
            ptr += 2;
        }
        else if (strict) {
            const rem = rleBuffer.length - ptr;
            const remBufHEX = rleBuffer.slice(ptr).slice(0, 40).toString('hex');
            console.warn(`  - PTS: ${sup.pts} - Excess RLE data: ${rem} bytes remaining, bytes: ${remBufHEX}...`);
            throw new Error('Excess RLE data');
        }
    }

    return {
        index: pixels,
        w,
        h
    };
}

const indicesToRGBA = (index, w, h, entries) => {
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < index.length; i++) {
        const px = entries.get(index[i]) || [0,0,0,0];
        const o = i * 4;
        rgba[o] = px[0];
        rgba[o + 1] = px[1];
        rgba[o + 2] = px[2];
        rgba[o + 3] = px[3];
    }
    return rgba;
};

const blitRGBA = (dst, dw, dh, src, sw, sh, dx, dy) => {
    for (let y = 0; y < sh; y++) {
        const yy = dy + y;
        if (yy < 0 || yy >= dh) continue;
        for (let x = 0; x < sw; x++) {
            const xx = dx + x;
            if (xx < 0 || xx >= dw) continue;
            const di = (yy * dw + xx) * 4;
            const si = (y * sw + x) * 4;
            const sr = src[si], sg = src[si+1], sb = src[si+2], sa = src[si+3] / 255;
            if (sa === 0) continue;
            const dr = dst[di], dg = dst[di+1], db = dst[di+2], da = dst[di+3] / 255;
            // source-over alpha blend
            const outA = sa + da * (1 - sa);
            const outR = (sr * sa + dr * da * (1 - sa)) / (outA || 1);
            const outG = (sg * sa + dg * da * (1 - sa)) / (outA || 1);
            const outB = (sb * sa + db * da * (1 - sa)) / (outA || 1);
            dst[di]   = outR | 0;
            dst[di+1] = outG | 0;
            dst[di+2] = outB | 0;
            dst[di+3] = Math.round(outA * 255);
        }
    }
};

const composeFrame = (record) => {
    const pcs = record.pcs;
    if (!pcs) return null;
    const palette = record.pds.get(pcs.paletteId);
    if (!palette) return null;
    const { w: compW, h: compH } = pcs;
    const frame = Buffer.alloc(compW * compH * 4);
    for (const ref of record.ref) {
        const obj = record.ods.get(ref.objectId);
        if (!obj || !obj.rle || obj.rle.length === 0) continue;
        const { index, w, h } = decodePGSIndexRLE(record, obj.rle, obj.w || w, obj.h || h);
        const rgba = indicesToRGBA(index, obj.w || w, obj.h || h, palette.entries);
        blitRGBA(frame, compW, compH, rgba, obj.w || w, obj.h || h, ref.pos_x, ref.pos_y);
    }
    return {
        start: record.pts,
        end: record.end ?? null,
        width: compW,
        height: compH,
        rgba: frame
    };
};

export default composeFrame;
