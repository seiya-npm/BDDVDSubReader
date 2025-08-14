import fs from 'node:fs';
import BufferReader from './module.buf.js';
import SPUImage from './module.spu.js';

const PS_PACK_SIZE = 0x800;

class VobSubParser {
    constructor(noIndex){
        this.noIndex = noIndex;
    }
    
    openFile(filePath){
        const targetPath = filePath.replace(/\.(sub|idx)$/i, '');
        const idxPath = targetPath + '.idx';
        const subPath = targetPath + '.sub';
        
        if(!fs.existsSync(subPath)) throw new Error('File ".sub" not exists!');
        const index = this.openIdxFile(idxPath);
        
        const subFile = fs.readFileSync(subPath);
        const subSize = fs.statSync(subPath).size;
        const subtitles = [];
        
        if (subSize % PS_PACK_SIZE > 0) throw new Error('File ".sub" bad file size');
        const reader = new BufferReader(subFile);
        
        const vobPacks = new Map();
        while(reader.remaining() / PS_PACK_SIZE > 0){
            //console.log('[READ] Reading VobPack:', vobPacks.length+1);
            const vobPack = new VobPackReader(vobPacks.size, index.paragraphs, reader);
            vobPacks.set(vobPacks.size, vobPack);
        }
        
        console.log(vobPacks);
    }
    
    openIdxText(idx){
        return new Index(idx);
    }
    
    openIdxFile(idxPath){
        if(fs.existsSync(idxPath) && !this.noIndex){
            const idx = fs.readFileSync(idxPath, 'utf-8');
            return new Index(idx);
        }
        
        return new Index('');
    }
}

class VobPackReader {
    constructor(packId, paragraphs, reader) {
        this.data = {
            forced: false,
            stream_id: null,
            pts: null,
            end: null,
            spu: null,
        };
        
        let spuBuffer = Buffer.alloc(0);
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
            spuBuffer = Buffer.concat([spuBuffer, chunk]);
            reader.seek(startOffset + 0x800);
            
            // check sizes
            if(spuBuffer.readUInt16BE() < spuBuffer.length) throw new Error('[BAD] SPU Buffer Size');
            
            // END
            if(spuBuffer.readUInt16BE() === spuBuffer.length) break;
        }
        
        this.data.spu = spuBuffer;
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
        // PTS/DTS clock is 90 kHz → ms
        return Number(pts) / 90;
    }
}

class Index {
    constructor(lines) {
        this.params = {};
        this.languages = new Map();
        this.paragraphs = new Map();
        this._parseLines(lines.split('\n'));
        
        if(!this.params.palette){
            this._parseLines([
                'palette:'
                + ' 000000, 0000ff, 00ff00, 0xff0000,'
                + ' ffff00, ff00ff, 00ffff, 0xffffff,'
                + ' 808000, 8080ff, 800080, 0x80ff80,'
                + ' 008080, ff8080, 555555, 0xaaaaaa'
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
                const language_name = this._getLanguageName(language_id);
                if (parts.length > 3 && parts[2].toLowerCase() === 'index') {
                    const txt_lang_index = parseInt(parts[3], 10);
                    if (!isNaN(txt_lang_index)){
                        stream_index = txt_lang_index;
                    }
                    else{
                        stream_index++;
                    }
                }
                this.languages.set(this.languages.size, { index: stream_index, id: language_id, title: language_name });
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
    
    _getLanguageName(language_id) {
        const language_names = {
            en: 'English',
            es: 'Spanish',
            fr: 'French',
            de: 'German',
        };
        return language_names[language_id] || language_id;
    }
}

export default class VobSubReader {
    constructor(vobSubPath, noIndex = false){
        const vobSubParser = new VobSubParser(noIndex);
        const data = vobSubParser.openFile(vobSubPath);
        return data;
    }
}
