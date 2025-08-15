import fs from 'node:fs';
import BufferReader from './module.buf.js';
import SPUImage from './module.spu.js';

const PS_PACK_SIZE = 0x800;
const PTS_CLOCK = 90;
const MAX_DELAY = 8000;
const MS_DELAY = 24;

class VobSubParser {
    constructor(noIndex){
        this._noIndex = noIndex;
    }
    
    openFile(filePath){
        const targetPath = filePath.replace(/\.(sub|idx)$/i, '');
        const idxPath = targetPath + '.idx';
        const subPath = targetPath + '.sub';
        
        if(!fs.existsSync(subPath)) throw new Error('File ".sub" not exists!');
        const index = this._openIdxFile(idxPath);
        
        const subFile = fs.readFileSync(subPath);
        const subSize = fs.statSync(subPath).size;
        const subtitles = [];
        
        if (subSize % PS_PACK_SIZE > 0) throw new Error('File ".sub" bad file size');
        const reader = new BufferReader(subFile);
        
        const frames = [];
        while(reader.remaining() / PS_PACK_SIZE > 0){
            const vobPack = new VobPackReader(frames.length, index, reader);
            const spuPack = new SPUPackReader(frames.length, index, vobPack);
            frames.push(spuPack);
        }
        
        return { languages: index.languages, frames };
    }
    
    _openIdxText(idx){
        return new Index(idx);
    }
    
    _openIdxFile(idxPath){
        if(fs.existsSync(idxPath) && !this._noIndex){
            const idx = fs.readFileSync(idxPath, 'utf-8');
            return new Index(idx);
        }
        
        return new Index('');
    }
}

class VobPackReader {
    constructor(packId, index, reader) {
        this.data = {
            forced: false,
            stream_id: null,
            pts: null,
            end: null,
            enx: null,
            spu: null
        };
        
        const paragraphs = index.paragraphs;
        let spuData = Buffer.alloc(0);
        
        if(paragraphs.has(packId)){
            const cur = paragraphs.get(packId);
            if(cur.filepos !== reader.tell()) throw new Error('[BAD] FilePos Index Value!');
            this.data.stream_id = cur.stream_index;
            this.data.pts = cur.timestamp;
        }
        
        while(true){
            const startOffset = reader.tell();
            
            if(reader.remaining() / PS_PACK_SIZE < 1) throw new Error('[BAD] Remaining Buffer Size!');
            if(reader.remaining() % PS_PACK_SIZE > 0) throw new Error('[BAD] Offset Buffer Position!');
            
            // PS Start
            const psStartCode = reader.readUInt24BE();
            const psPackId = reader.readUInt8();
            
            if(psStartCode !== 0x1 || psPackId !== 0xba){
                throw new Error('[BAD] PS Packet Header');
            }
            
            // System Clock Reference
            reader.skip(6);
        
            // Multiplexer Rate
            reader.skip(3);
        
            // Reserved and Stuffing Length (5bit + 3bit)
            const psStuffingLength = reader.readUInt8() & 0b111;
            reader.skip(psStuffingLength);
            
            // PES Start
            const pesStartCode = reader.readUInt24BE();
            const pesPackId = reader.readUInt8();
        
            if(pesStartCode !== 0x1 || pesPackId !== 0xbd){
                throw new Error('[BAD] PES Packet Header');
            }
            
            // PES Pack length
            const pesPacketLength = reader.readUInt16BE();
            const nextOffset = reader.tell() + pesPacketLength;
            
            // PES Header Main Data 0b10XXXXXX 0bXXXXXXXX
            const pesHeaderFlags = reader.readUInt16BE();
            const pstDtsFlags = (pesHeaderFlags >> 6) & 0b11;
            const isHasPts = pstDtsFlags == 0b10 || pstDtsFlags == 0b11;
            
            // PES Header Data length
            const pesHeaderDataLength = reader.readUInt8();
            const pesHeaderData = reader.readBytes(pesHeaderDataLength);
        
            if(pesHeaderDataLength >= 5 && isHasPts){
                const ptsDataBuf = pesHeaderData.subarray(0, 5);
                const ptsValue = this._readPtsFromBuf(ptsDataBuf);
                if(this.data.pts === null) this.data.pts = ptsValue;
                
                if(this.data.pts >= 0 && ptsValue !== this.data.pts) throw new Error('[BAD] PTS Value');
            }
            
            const stream_id = reader.readUInt8();
            if (stream_id < 0x20 || stream_id > 0x40){
                throw new Error('[BAD] Stream ID!');
            }
            
            if(this.data.stream_id === null) this.data.stream_id = stream_id - 0x20;
            if(stream_id - 0x20 !== this.data.stream_id) throw new Error('[BAD] Stream ID!');
            
            // save spuBuffer
            const spuChunkLength = (nextOffset - startOffset) - (reader.tell() - startOffset);
            const chunk = reader.readBytes(spuChunkLength);
            spuData = Buffer.concat([spuData, chunk]);
            reader.seek(startOffset + 0x800);
            
            // check sizes
            if(spuData.readUInt16BE() < spuData.length) throw new Error('[BAD] SPU Buffer Size');
            
            // END
            if(spuData.readUInt16BE() === spuData.length) break;
        }
        
        this.data.spu = spuData;
        return this.data;
    }
    
    _readPtsFromBuf(buf) {
        const [b0, b1, b2, b3, b4] = buf;
        const pts = (
            (BigInt(b0 & 0x0E) << 29n) | // PTS[32..30]
            (BigInt(b1)        << 22n) | // PTS[29..22]
            (BigInt(b2 & 0xFE) << 14n) | // PTS[21..15]
            (BigInt(b3)        <<  7n) | // PTS[14..7]
            (BigInt(b4 & 0xFE) >>  1n)   // PTS[6..0]
        );
        return Number(pts) / PTS_CLOCK;
    }
}

class SPUPackReader {
    constructor(packId, index, pack) {
        const spuBuffer = new BufferReader(pack.spu);
        const spuBufSize = spuBuffer.readUInt16BE();
        delete pack.spu;
        
        const ctrlOffset = spuBuffer.readUInt16BE();
        spuBuffer.seek(ctrlOffset);
        
        const ctrl = [];
        while(spuBuffer.tell() < spuBufSize){
            const ctrlData = { delay: 0, commands: Buffer.alloc(0) };
            ctrlData.delay = Math.round((spuBuffer.readUInt16BE() << 10) / PTS_CLOCK);
            const ctrlOffset = spuBuffer.readUInt16BE();
            if(ctrlOffset === spuBuffer.tell() - 4){
                ctrlData.commands = new BufferReader(spuBuffer.buffer.subarray(spuBuffer.tell()));
                ctrl.push(ctrlData);
                break;
            }
            else{
                ctrlData.commands = new BufferReader(spuBuffer.buffer.subarray(spuBuffer.tell(), ctrlOffset));
                spuBuffer.seek(ctrlOffset);
                ctrl.push(ctrlData);
            }
        }
        
        if(ctrl.length > 2){
            throw new Error('[BAD] Too many command sequences');
        }
        
        // set temp data
        const tdata = {};
        let PXDtf, PXDbf;
        
        // parse commands
        let ctrlIndex = 0;
        while (ctrlIndex < ctrl.length) {
            const curCtrl = ctrl[ctrlIndex];
            const cmdBuf = curCtrl.commands;
            while(cmdBuf.remaining() > 0){
                const cmd = cmdBuf.readUInt8();
                
                switch (cmd){
                    case 0x00: // FSTA_DSP
                        pack.forced = true;
                        break;
                    case 0x01: // STA_DSP
                        if(pack.pts >= 0 && curCtrl.delay > 0){
                            throw new Error('BAD COMMAND: Start Display!');
                        }
                        pack.pts += curCtrl.delay;
                        break;
                    case 0x02: // STP_DSP
                        if(pack.end !== null && pack.end > 0){
                            throw new Error('BAD COMMAND: End Display!');
                        }
                        pack.end = pack.pts + curCtrl.delay;
                        break;
                    case 0x03: // SET_COLOR
                        // e2 e1   p b
                        // 0   background (B)
                        // 1   pattern (P)
                        // 2   emphasis 1 (E1)
                        // 3   emphasis 1 (E2)
                        const cmd3data = cmdBuf.readUInt16BE();
                        // => 2 8 2 0
                        tdata.palette = {
                            b:  index.params.palette[cmd3data & 0xF],
                            p:  index.params.palette[cmd3data >> 4 & 0xF],
                            e1: index.params.palette[cmd3data >> 8 & 0xF],
                            e2: index.params.palette[cmd3data >> 12 & 0xF],
                        };
                        
                        break;
                    case 0x04: // SET_CONTR
                        const cmd4data = cmdBuf.readUInt16BE();
                        tdata.alpha = {
                            b:  cmd4data & 0xF,
                            p:  cmd4data >> 4 & 0xF,
                            e1: cmd4data >> 8 & 0xF,
                            e2: cmd4data >> 12 & 0xF,
                        };
                        
                        break;
                    case 0x05: // SET_DAREA
                        // sx sx   sx ex   ex ex   sy sy   sy ey   ey ey
                        // sx = starting X coordinate
                        // ex = ending X coordinate
                        // sy = starting Y coordinate
                        // ey = ending Y coordinate
                        const x = cmdBuf.readUInt24BE();
                        const y = cmdBuf.readUInt24BE();
                        
                        tdata.pos = {
                            left:   x >> 12,
                            right:  x & 0xFFF,
                            top:    y >> 12,
                            bottom: y & 0xFFF,
                        };
                        
                        if(tdata.pos.right < tdata.pos.left || tdata.pos.bottom < tdata.pos.top){
                            throw new Error('[BAD] Invalid Bounding Box');
                        }
                        
                        tdata.size = {};
                        tdata.size.width = tdata.pos.right - tdata.pos.left + 1;
                        tdata.size.height = tdata.pos.bottom - tdata.pos.top + 1;
                        
                        break;
                    case 0x06: // SET_DSPXA
                        const PXDtfOffset = cmdBuf.readUInt16BE();
                        const PXDbfOffset = cmdBuf.readUInt16BE();
                        
                        PXDtf = spuBuffer.buffer.subarray(PXDtfOffset);
                        PXDbf = spuBuffer.buffer.subarray(PXDbfOffset);
                        
                        break;
                    case 0x07: // CHG_COLCON
                        throw new Error('[BAD] COMMAND 0x07 NOT IMPLEMENTED!');
                        break;
                    case 0xFF: // CMD_END
                        cmdBuf.skip(cmdBuf.remaining())
                        break;
                    default: // CMD_UNK
                        throw new Error('[BAD] UNKNOWN COMMAND!');
                }
            }
            // end command
            ctrlIndex++;
        }
        
        if(pack.end === null && index.paragraphs.has(packId+1)){
            const next = index.paragraphs.get(packId+1);
            pack.end = next.timestamp - MS_DELAY;
            pack.enx = pack.end - pack.pts;
        }
        if(pack.end === null || pack.end - pack.pts > MAX_DELAY){
            pack.end = pack.pts + MAX_DELAY;
            pack.enx = MAX_DELAY;
        }
        
        pack.width = tdata.size.width;
        pack.height = tdata.size.height;
        const pic = new SPUImage(tdata.size.width, tdata.size.height);
        pic.setPalette(tdata.palette, tdata.alpha);
        pic.decompressRLEImage(PXDtf, PXDbf);
        pack.rgba = pic.getPxData();
        return pack;
    }
}

class Index {
    constructor(lines) {
        this.params = {};
        this.languages = new Map();
        this.paragraphs = new Map();
        this._getLanguageName = new Intl.DisplayNames(['en'], {type: 'language', style: 'short'});
        this._parseLines(lines.split('\n'));
        
        if(!this.params.palette){
            this._parseLines([
                'palette:' // From FFMPEG
                + ' 000000, 0000ff, 00ff00, ff0000,'
                + ' ffff00, ff00ff, 00ffff, ffffff,'
                + ' 808000, 8080ff, 800080, 80ff80,'
                + ' 008080, ff8080, 555555, aaaaaa'
            ]);
        }
    }

    _parseLines(lines) {
        const sizeLP = /^size\: (?<width>\d+)x(?<height>\d+)$/;
        const originLP = /^org\: (?<x>\d+), (?<y>\d+)$/;
        const scaleLP = /^scale\: (?<horizontal>\d+)%, (?<vertical>\d+)%$/;
        const alphaLP = /^alpha\: (?<value>\d+)%$/;
        const fadeLP = /^fadein\/out\: (?<fadein>\d+), (?<fadeout>\d+)$/;
        const timeCodeLP = /^timestamp\: (?<h>\d+):(?<m>\d+):(?<s>\d+):(?<ms>\d+), filepos: (?<filepos>[\da-fA-F]+)$/;
        let stream_index = -1;
        
        lines.forEach(line => {
            line = line.trim();
            
            if(sizeLP.test(line)){
                const [width, height] = Object.values(line.match(sizeLP).groups).map(v => parseInt(v));
                this.params.size = { width, height };
            }
            
            if(originLP.test(line)){
                const [x, y] = Object.values(line.match(originLP).groups).map(v => parseInt(v));
                this.params.origin = { x, y };
            }
            
            if(scaleLP.test(line)){
                const [horizontal, vertical] = Object.values(line.match(scaleLP).groups).map(v => parseFloat(v) / 100);
                this.params.scale = { horizontal, vertical };
            }
            
            if(alphaLP.test(line)){
                const [ value ] = Object.values(line.match(alphaLP).groups).map(v => parseFloat(v) / 100);
                this.params.alpha = value;
            }
            
            if(/^smooth\:/i.test(line) && line.length > 8){
                const value = line.substring('smooth:'.length + 1).toUpperCase();
                if (value == 'OLD' || value == '2') this.params.smooth = 2;
                if (value == 'ON'  || value == '1') this.params.smooth = 1;
                if (value == 'OFF' || value == '0') this.params.smooth = 0;
            }
            
            if(fadeLP.test(line)){
                const [ fadein, fadeout ] = Object.values(line.match(fadeLP).groups).map(v => parseInt(v));
                this.params.fade = { fadein, fadeout };
            }
            
            if(/^align\: (OFF|ON) at (LEFT|CENTER|RIGHT) (TOP|CENTER|BOTTOM)$/i.test(line)){
                this.params.align = {};
                const value = line.substring('align:'.length + 1).toUpperCase().split(/ at /i).map(v => v.trim().split(' '));
                const [ align, alignh, alignv ] = [ value[0][0], value[1][0], value[1][1] ];
                if (align == 'ON'  || align == '1') this.params.align.on = true;
                if (align == 'OFF' || align == '0') this.params.align.on = false;
                if (alignh == 'LEFT'  ) this.params.align.horizontal = 0;
                if (alignh == 'CENTER') this.params.align.horizontal = 1;
                if (alignh == 'RIGHT' ) this.params.align.horizontal = 2;
                if (alignv == 'TOP'   ) this.params.align.vertical = 0;
                if (alignv == 'CENTER') this.params.align.vertical = 1;
                if (alignv == 'BOTTOM') this.params.align.vertical = 2;
            }
            
            if(/^time offset\: (?<is_negative>-)?(?<offset>\d+)$/i.test(line)){
                this.params.time_offset = 0; // ignore for now...
            }
            
            if(/^forced subs\: (OFF|ON|0|1)$/i.test(line)){
                const value = line.substring('forced subs:'.length + 1).toUpperCase();
                if (value == 'ON'  || value == '1') this.params.forced_subs = true;
                if (value == 'OFF' || value == '0') this.params.forced_subs = false;
            }
            
            if(/^palette\:/i.test(line) && line.length > 10){
                this.params.palette = [];
                const colors = line.substring('palette:'.length + 1).split(/[,\s]+/).filter(Boolean);
                colors.forEach(hex => this.params.palette.push(this._hexToColor(hex)));
            }
            
            if(/^id\:/i.test(line) && line.length > 4){
                const parts = line.split(/[:,\s]+/).filter(Boolean);
                const language_id = parts[1];
                const language_name = this._getLanguageName.of(language_id);
                if (parts.length > 3 && parts[2].toLowerCase() === 'index') {
                    const txt_lang_index = parseInt(parts[3], 10);
                    if (!isNaN(txt_lang_index)){
                        stream_index = txt_lang_index;
                    }
                    else{
                        stream_index++;
                    }
                }
                this.languages.set(stream_index, { id: language_id, title: language_name });
            }
            
            if(timeCodeLP.test(line)){
                const [ h, m, s, ms, filepos ] = Object.entries(line.match(timeCodeLP).groups).map(v => {
                    return parseInt(v[1], v[0] == 'filepos' ? 16 : 10);
                });
                const timestamp = (h * 3600 + m * 60 + s) * 1000 + ms;
                this.paragraphs.set(this.paragraphs.size, { stream_index, timestamp, filepos });
            }
        });
    }
    
    _hexToColor(hex) {
        hex = hex.replace(/^#/, '').trim();
        if (hex.length === 6) {
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            return { r, g, b };
        }
        else if (hex.length === 8) {
            const a = parseInt(hex.substr(0, 2), 16);
            const r = parseInt(hex.substr(2, 2), 16);
            const g = parseInt(hex.substr(4, 2), 16);
            const b = parseInt(hex.substr(6, 2), 16);
            return { r, g, b, a };
        }
        return { r: 255, g: 255, b: 255 };
    }
}

export default class VobSubReader {
    constructor(vobSubPath, noIndex = false){
        const vobSubParser = new VobSubParser(noIndex);
        const data = vobSubParser.openFile(vobSubPath);
        return data;
    }
}
