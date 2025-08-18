import fs from 'node:fs';

import composeFrame from './module.rle.js';
import BufferReader from './module.buf.js';

const TYPE = {
    PCS: 0x16,
    WDS: 0x17,
    PDS: 0x14,
    ODS: 0x15,
    END: 0x80,
};

function getCONST(obj, value) {
    return Object.keys(obj).find(key => obj[key] === value) || 'BAD';
}

class Segment {
    constructor(reader) {
        const start = reader.readString(2);
        if (start !== 'PG') {
            throw new Error('Invalid segment header');
        }
        this.pts = Math.round(reader.readUInt32BE() / 90);
        this.dts = Math.round(reader.readUInt32BE() / 90);
        this.type = reader.readUInt8();
        this.size = reader.readUInt16BE();
        this.data = reader.readBytes(this.size);
        delete this.size;
    }
}

class DisplaySetState {
    constructor() {
        this.pts = null;      // PTS START
        this.pcs = null;      // Presentation Composition
        this.pds = new Map(); // Palette Definition / PaletteId -> { [entryId]: { y, cr, cb, a } }
        this.ods = new Map(); // Object Definition / ObjectId -> { w, h, rle: Buffer, isComplete }
        this.ref = [];        // from PCS: [{ objectId, x, y, compositionFlag }]
    }
    resetForComposition() {
        this.pts = null;
        this.pcs = null;
        this.ref = [];
    }
    resetForEpoch() {
        this.resetForComposition();
        this.pds.clear();
        this.ods.clear();
    }
    saveState(displaySetsMap){
        const newKey = displaySetsMap.size;
        const prevKey = newKey - 1;
        
        const record = {
            pts: this.pts,
            end: null,
            pcs: this.pcs,
            pds: new Map(this.pds),
            ods: new Map(this.ods),
            ref: this.ref.slice(),
            prevKey: displaySetsMap.has(prevKey) ? prevKey : null,
            nextKey: null,
        };
        
        displaySetsMap.set(newKey, record);
        
        if (record.prevKey !== null) {
            const prev = displaySetsMap.get(record.prevKey);
            if (prev){
                prev.nextKey = newKey;
                if (prev.ref.length > 0){
                    prev.end = this.pts;
                }
            }
        }
    }
}

export default class BDSupReader {
    constructor(filePath) {
        this.filePath = filePath;
        
        return this.extractFrames();
    }
    
    _YCrCbA2RGBA(YCrCbA, isBT709) {
        const [Y, Cr, Cb, a] = YCrCbA;
        const Y1 = Y - 16;
        const Cr1 = Cr - 128;
        const Cb1 = Cb - 128;
        
        let r, g, b;
        if(isBT709){
            r = (298 * Y1 + 459 * Cr1 + 128) >> 8;
            g = (298 * Y1 - 55 * Cb1 - 136 * Cr1 + 128) >> 8;
            b = (298 * Y1 + 541 * Cb1 + 128) >> 8;
        }
        else{
            r = (298 * Y1 + 409 * Cr1 + 128) >> 8;
            g = (298 * Y1 - 100 * Cb1 - 208 * Cr1 + 128) >> 8;
            b = (298 * Y1 + 516 * Cb1 + 128) >> 8;
        }
        
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        
        return [r, g, b, a];
    }
    
    parsePCS(pts, buf, state) {
        if(state.pts !== null) throw new Error('Unexpected Presentation Composition Segment');
        state.pts = pts;
        
        buf = new BufferReader(buf);
        const pcs = {};
        
        pcs.w = buf.readUInt16BE();
        pcs.h = buf.readUInt16BE();
        buf.skip(1); // Skip frameRate
        
        pcs.compositionNumber = buf.readUInt16BE();
        pcs.compositionState = buf.readUInt8() & 0xC0;
        
        buf.skip(1); // Skip Palette Update Flag
        pcs.paletteId = buf.readUInt8();
        
        const objRefs = [];
        let objCount = buf.readUInt8();
        for(const _ in [...Array(objCount)]){
            const obj = {};
            obj.objectId = buf.readUInt16BE();
            buf.skip(1); // Skip window
            
            const cropAndForcedByte = buf.readUInt8();
            const cropFlag = (cropAndForcedByte & 0x80) !== 0;
            const forcedFlag = (cropAndForcedByte & 0x40) !== 0;
            if (forcedFlag) obj.is_forced = true;
            
            obj.pos_x = buf.readUInt16BE();
            obj.pos_y = buf.readUInt16BE();
            
            if(cropFlag){
                obj.crop = {
                    pos_x: buf.readUInt16BE(),
                    pos_y: buf.readUInt16BE(),
                    w: buf.readUInt16BE(),
                    h: buf.readUInt16BE(),
                };
            }
            
            objRefs.push(obj);
        }
        
        if(objRefs.length > 2) throw new Error('BAD REF COUNT!');
        state.ref = objRefs;
        state.pcs = pcs;
        
        if(buf.remaining() !== 0){
            throw new Error('Unexpected remaining Buffer Size in Presentation Composition Segment');
        }
    }
    
    parsePDS(pts, buf, state) {
        if(state.pts === null) throw new Error('Unexpected Palette Definition Segment');
        if(pts > state.pts) throw new Error(`Unexpected PTS in Palette Definition Segment: ${state.pts} vs ${pts}`);
        
        buf = new BufferReader(buf);
        
        const paletteId = buf.readUInt8();
        buf.skip(1); // Skip palette version
        
        if(buf.remaining() % 5 > 0){
            throw new Error('Unexpected Buffer length in Palette Definition Segment')
        }
        
        const entries = new Map();
        while(buf.remaining() > 0) {
            const entryId = buf.readUInt8();
            const y = buf.readUInt8();
            const cr = buf.readUInt8();
            const cb = buf.readUInt8();
            const a = buf.readUInt8();
            const isBT709 = !state.pcs || state.pcs.h > 576;
            const c = this._YCrCbA2RGBA([y, cr, cb, a], isBT709);
            entries.set(entryId, c);
        }
        
        state.pds.set(paletteId, { entries });
        
        if(buf.remaining() !== 0){
            throw new Error('Unexpected remaining Buffer Size in Palette Definition Segment');
        }
    }
    
    parseODS(pts, buf, state) {
        if(state.pts === null) throw new Error('Unexpected Object Definition Segment');
        if(pts > state.pts) throw new Error(`Unexpected PTS in Object Definition Segment: ${state.pts} vs ${pts}`);
        
        buf = new BufferReader(buf);
        
        if(buf.remaining() <= 4){
            throw new Error('Bad Buffer Size in Object Definition Segment');
        }
        
        const objectId = buf.readUInt16BE();
        buf.skip(1); // Skip version
        
        const seqFlag = buf.readUInt8();
        const isStart = (seqFlag & 0x80) !== 0;
        
        if (isStart) {
            state.ods.set(objectId, {
                w: null,
                h: null,
                rle: Buffer.alloc(0),
                rem: null,
            });
        }
        
        const cur = state.ods.get(objectId);
        
        if (!isStart) {
            const remSliceLen = buf.remaining();
            
            if (cur.rle.length === 0) {
                throw new Error('Additional RLE encountered but no existing RLE buffer');
            }
            if (remSliceLen > cur.rem) {
                throw new Error('Additional RLE exceeds expected remaining length');
            }
            
            const chunk = buf.readBytes(remSliceLen);
            cur.rle = Buffer.concat([cur.rle, chunk]);
            cur.rem -= remSliceLen;
            
            if(buf.remaining() !== 0){
                // can have several 'last' chunks?
                throw new Error('Unexpected remaining Buffer Size in Object Definition Segment');
            }
            
            return;
        }
        
        if(buf.remaining() <= 7){
            throw new Error('Bad Buffer Size in Object Definition Segment');
        }
        
        const rleBitmapLen = buf.readUInt24BE() - 4;
        cur.w = buf.readUInt16BE();
        cur.h = buf.readUInt16BE();
        
        if (buf.remaining() > rleBitmapLen) {
            throw new Error('Buffer Size bigger than RLE Bitmap Length in Object Definition Segment');
        }
        
        const toCopy = buf.remaining();
        const chunk = buf.readBytes(toCopy);
        
        cur.rle = Buffer.concat([cur.rle, chunk]);
        cur.rem = rleBitmapLen - toCopy;
        
        if(buf.remaining() !== 0){
            throw new Error('Unexpected remaining Buffer Size in Object Definition Segment');
        }
    }
    
    parseEND(pts, state, stateStorage){
        if(state.pts === null) throw new Error('Unexpected End Definition Segment');
        if(pts > state.pts) throw new Error(`Unexpected PTS in End Definition Segment: ${state.pts} vs ${pts}`);
        
        state.saveState(stateStorage);
        state.resetForComposition();
    }
    
    readSegments() {
        const buffer = fs.readFileSync(this.filePath);
        const reader = new BufferReader(buffer);
        const displaySets = new Map();
        
        try {
            const state = new DisplaySetState();
            
            while (reader.tell() + 13 <= buffer.length) {
                const seg = new Segment(reader);
                
                if(seg.type === TYPE.PCS){
                    const pcfBuf = new BufferReader(seg.data);
                    pcfBuf.skip(7);
                    
                    const cstateBits = pcfBuf.readUInt8() & 0xC0;
                    if (cstateBits !== 0x00) state.resetForEpoch();
                }
                
                switch (seg.type) {
                    case TYPE.PCS:
                        this.parsePCS(seg.pts, seg.data, state);
                        break;
                    case TYPE.WDS:
                        break;
                    case TYPE.PDS:
                        this.parsePDS(seg.pts, seg.data, state);
                        break;
                    case TYPE.ODS:
                        this.parseODS(seg.pts, seg.data, state);
                        break;
                    case TYPE.END:
                        this.parseEND(seg.pts, state, displaySets)
                        break;
                    default:
                        throw new Error('Unexpected Unknown Segment Type');
                }
            }
        }
        catch (err) {
            console.warn('Stopped reading due to error:', err.message);
            console.warn(err);
        }
        
        return displaySets;
    }
    
    extractFrames() {
        const displaySets = this.readSegments();
        const frames = [];
        
        for (const [, record] of displaySets) {
            if (record.ref.length === 0) continue;
            const composed = composeFrame(record);
            if (composed) frames.push(composed);
        }
        
        return frames;
    }
}
