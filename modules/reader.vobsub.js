import fs from 'node:fs';
import BufferReader from './module.buf.js';
import SPUImage from './module.spu.js';

class VobSubParser {
    constructor(noIndex){
        this.noIndex = noIndex;
    }
    
    openFile(filePath){
        const targetPath = filePath.replace(/\.(sub|idx)$/i, '');
        const idxPath = targetPath + '.idx';
        const subPath = targetPath + '.sub';
        
        if(!fs.existsSync(subPath)) throw new Error('File ".sub" not exists!');
        const index = this.openIdx(idxPath);
        
        const subFile = fs.readFileSync(subPath);
        const subSize = fs.statSync(subPath).size;
        const subtitles = [];
        
        if (subSize % 0x800 > 0) throw new Error('File ".sub" bad file size');
        let offset = 0;
        
        const reader = new BufferReader(subFile);
        const psPack = new PSPackReader(reader.readBytes(0x800));
        console.log(psPack);
        
        /*
        while(offset < subSize){
            const frameBuf = sub.subarray(offset);
            const frameData = new VobSubPack(idx, {}, {}, frameBuf);
            const extFrameData = frameData._readPack();
            this.subtitles.push(extFrameData);
            offset += extFrameData.pack_size;
        }
        */
        
        /*
        while(seq < this.paragraphs.length){
            const is_last = this.paragraphs.length < seq + 2 ? true : false;
            const paragraph = this.paragraphs[seq];
            const nextParagraph = is_last ? {} : this.paragraphs[seq + 1];
            
            const offsetStart = paragraph.filepos;
            const offsetEnd = is_last ? subSize : nextParagraph.filepos;
            const frameBuf = sub.subarray(offsetStart, offsetEnd);
            
            const frameData = new VobSubPack(this.index, paragraph, nextParagraph, frameBuf);
            this.subtitles.push(frameData._readPack());
            
            seq++;
        }
        */
    }
    
    openIdx(idxPath){
        if(fs.existsSync(idxPath) && !this.noIndex){
            const idx = fs.readFileSync(idxPath, 'utf-8');
            const index = new Index(idx);
            
            return index;
        }
        
        return {}; // { force_sp_size: true };
    }
    
    /*
    _openSub(vobSubPath){
        const subFile = vobSubPath + '.sub';
        if(fs.existsSync(subFile)){
            const subSize = fs.statSync(subFile).size;
            const sub = fs.readFileSync(subFile);
            const idx = { force_sp_size: true };
            this.subtitles = [];
            
            let offset = 0;
            
            while(offset < subSize){
                const frameBuf = sub.subarray(offset);
                const frameData = new VobSubPack(idx, {}, {}, frameBuf);
                const extFrameData = frameData._readPack();
                this.subtitles.push(extFrameData);
                offset += extFrameData.pack_size;
            }
            
            let seq = 0;
            
            while(seq < this.subtitles.length){
                const subframe = this.subtitles[seq];
                const pic = new SPUImage(subframe.size.width, subframe.size.height);
                pic.setPalette(subframe.palette, subframe.alpha);
                pic.decompressRLEImage(subframe.rle.tf, subframe.rle.bf);
                this.subtitles[seq].rgba = pic.getPxData();
                
                delete this.subtitles[seq].pack_size;
                delete this.subtitles[seq].palette;
                delete this.subtitles[seq].alpha;
                delete this.subtitles[seq].rle;
                
                seq++;
            };
        }
        else{
            throw new Error('File(s) not exists!');
        }
        
        return { subtitles: this.subtitles };
    }
    */
    
    /*
    _open(vobSubPath){
        const idxFile = vobSubPath + '.idx';
        const subFile = vobSubPath + '.sub';
        if(fs.existsSync(idxFile) && fs.existsSync(subFile)){
            const idx = fs.readFileSync(idxFile, 'utf-8');
            const index = new Index(idx);
            
            this.index = index.params;
            this.languages = index.languages;
            this.paragraphs = index.paragraphs;
            this.subtitles = [];
            
            const subSize = fs.statSync(subFile).size;
            const sub = fs.readFileSync(subFile);
            
            let seq = 0;
            
            while(seq < this.paragraphs.length){
                const is_last = this.paragraphs.length < seq + 2 ? true : false;
                const paragraph = this.paragraphs[seq];
                const nextParagraph = is_last ? {} : this.paragraphs[seq + 1];
                
                const offsetStart = paragraph.filepos;
                const offsetEnd = is_last ? subSize : nextParagraph.filepos;
                const frameBuf = sub.subarray(offsetStart, offsetEnd);
                
                const frameData = new VobSubPack(this.index, paragraph, nextParagraph, frameBuf);
                this.subtitles.push(frameData._readPack());
                
                seq++;
            }
            
            seq = 0;
            
            while(seq < this.subtitles.length){
                const subframe = this.subtitles[seq];
                const pic = new SPUImage(subframe.size.width, subframe.size.height);
                pic.setPalette(subframe.palette, subframe.alpha);
                pic.decompressRLEImage(subframe.rle.tf, subframe.rle.bf);
                this.subtitles[seq].rgba = pic.getPxData();
                
                delete this.subtitles[seq].pack_size;
                delete this.subtitles[seq].palette;
                delete this.subtitles[seq].alpha;
                delete this.subtitles[seq].rle;
                
                //break;
                seq++;
            };
        }
        else{
            throw new Error('File(s) not exists!');
        }
        
        return { languages: this.languages, subtitles: this.subtitles };
    }
    */
}

class PSPackReader {
    constructor(buffer) {
        if(buffer.length % 0x800 > 0){
            throw new Error('BAD MPEG-2 Pack!');
        }
        
        const reader = new BufferReader(buffer);
        
        const psStartCode = reader.readUInt24BE();
        const psPackId = reader.readUInt8();
        
        if(psStartCode !== 0x1 || psPackId !== 0xba){
            throw new Error('[BAD] PS Packet Header');
        }
        
        // System Clock Reference, skip parse
        reader.skip(6);
    }
}

class VobSubPack {
    constructor(buffer, index) {
        // this.index = index || {};
        // this.paragraph = paragraph || {};
        // this.nextParagraph = nextParagraph || {};
        // this.buffer = buffer;
        
        if(this.buffer.length % 0x800 > 0){
            throw new Error('BAD MPEG-2 Pack!');
        }
        
        // this._resetOffsets();
    }
    
    /*
    _readBuf(size, returnRead){
        const res = this.buffer.subarray(this._offset, this._offset + size);
        if (!returnRead){
            this._readOffset = this._offset;
            this._offset += size;
        }
        return res;
    }
    
    _resetOffsets(){
        this._offset = 0;
        this._readOffset = 0;
    }
    */
    
    _readPtsFromBuf(buf) {
        const [b0, b1, b2, b3, b4] = buf;
        const pts =(
            (BigInt(b0 & 0x0E) << 29n) | // PTS[32..30]
            (BigInt(b1)        << 22n) | // PTS[29..22]
            (BigInt(b2 & 0xFE) << 14n) | // PTS[21..15]
            (BigInt(b3)        <<  7n) | // PTS[14..7]
            (BigInt(b4 & 0xFE) >>  1n)   // PTS[6..0]
        );
        // PTS/DTS clock is 90 kHz → ms
        return Number(pts) / 90;
    }
    
    _readPack(){
        /*
        this.data = {};
        this.data.forced = false;
        this.data.stream_id = this.paragraph.stream_index;
        
        this.data.pts = 0;
        this.data.start_time = -1;
        this.data.end_time = -1;
        
        let psBufferSize = this.buffer.length;
        let spBuffer = Buffer.alloc(0);
        
        while(this._offset < psBufferSize){
            // special markers
            const startOffset = this._offset;
            
            // PS Header
            const psStartCode = this._readBuf(3).readUIntBE(0, 3);
            const psPackId = this._readBuf(1).readUInt8();
            if(psStartCode !== 0x1 || psPackId !== 0xba){
                throw new Error('[BAD] PS Packet Header');
            }
            
            // System Clock Reference, skip parse
            this._offset += 6;
            
            // Multiplexer Rate, skip parse
            this._offset += 3;
            
            // Reserved and Stuffing Length (5bit + 3bit)
            const psStuffingLength = (this._readBuf(1).readUInt8() & 0b111);
            this._offset += psStuffingLength;
            
            // PES Header
            const pesStartCode = this._readBuf(3).readUIntBE(0, 3);
            const pesPackId = this._readBuf(1).readUInt8();
            if(pesStartCode !== 0x1 || pesPackId !== 0xbd){
                throw new Error('[BAD] PES Packet Header');
            }
            
            // PES Pack length
            const pesPacketLength = this._readBuf(2).readUInt16BE();
            const nextOffset = this._offset + pesPacketLength;
            
            // PES Header Main Data 0b10XXXXXX 0bXXXXXXXX
            const pesHeaderFlags         = this._readBuf(2).readUInt16BE();
            const pstDtsFlags            = (pesHeaderFlags >> 6) & 0b11;
            
            // PES Header Data length
            const pesHeaderDataLength = this._readBuf(1).readUInt8();
            const pesHeaderData = this.buffer.subarray(this._offset, this._offset + pesHeaderDataLength);
            this._offset += pesHeaderDataLength;
            
            if(pesHeaderDataLength > 0){
                let headerDataOffset = 0;
                
                if(pstDtsFlags == 0b10 || pstDtsFlags == 0b11){
                    const ptsDataBuf = pesHeaderData.subarray(headerDataOffset, headerDataOffset + 5);
                    this.data.pts = this._readPtsFromBuf(ptsDataBuf);
                    headerDataOffset += 5;
                }
                if (pstDtsFlags == 0b11){
                    // Skip DTS Parse
                    headerDataOffset += 5;
                }
            }
            
            // set stream id
            const stream_id = this._readBuf(1).readUInt8();
            if (stream_id < 0x20 || stream_id > 0x40){
                throw new Error('BAD Stream ID!');
            }
            if(typeof this.data.stream_id === 'undefined'){
                this.data.stream_id = stream_id - 0x20;
            }
            if (stream_id - 0x20 != this.data.stream_id){
                throw new Error('BAD Stream ID!');
            }
            
            // to end offset
            const bytesLeft = (nextOffset - startOffset) - (this._offset - startOffset);
            spBuffer = Buffer.concat([spBuffer, this._readBuf(bytesLeft)]);
            
            // next pack
            this._offset = startOffset + 0x800;
            const checkBySPSize = this.index.force_sp_size ? spBuffer.readUInt16BE() == spBuffer.length : false;
            
            // fix next
            if(nextOffset - startOffset < 0x800 || checkBySPSize){
                psBufferSize = this._offset;
            }
        }
        
        this.data.pack_size = this._offset;
        const spBufferSize = spBuffer.readUInt16BE();
        if(spBuffer.length !== spBufferSize){
            throw new Error('BAD SPU Buffer Size');
        }
        
        this._resetOffsets();
        this.buffer = spBuffer;
        this._offset += 2;
        
        let PXDtf, PXDbf;
        const ctrlOffset = this._readBuf(2).readUInt16BE();
        this._offset = ctrlOffset;
        
        const ctrl = [];
        while(this._offset < spBufferSize){
            const ctrlData = { delay: 0, commands: Buffer.alloc(0) };
            ctrlData.delay = Math.round((this._readBuf(2).readUInt16BE() << 10) / 90);
            const ctrlOffset = this._readBuf(2).readUInt16BE();
            if(ctrlOffset === this._offset - 4){
                ctrlData.commands = this.buffer.subarray(this._offset);
                ctrl.push(ctrlData);
                break;
            }
            else{
                ctrlData.commands = this.buffer.subarray(this._offset, ctrlOffset);
                this._offset = ctrlOffset;
                ctrl.push(ctrlData);
            }
        }
        
        if(ctrl.length > 2){
            throw new Error('Too many command sequences');
        }
        
        let ctrlIndex = 0;
        while (ctrlIndex < ctrl.length) {
            let cmdOffset = 0;
            const curCtrl = ctrl[ctrlIndex];
            while(cmdOffset < curCtrl.commands.length){
                const cmdBuf = curCtrl.commands;
                const cmd = cmdBuf.readUInt8(cmdOffset);
                cmdOffset += 1;
                
                switch (cmd){
                    case 0x00: // FSTA_DSP
                        this.data.forced = true;
                    case 0x01: // STA_DSP
                        if(this.data.start_time > -1){
                            throw new Error('BAD COMMAND: Start Display!');
                        }
                        this.data.start_time = this.data.pts + curCtrl.delay;
                        break;
                    case 0x02: // STP_DSP
                        if(this.data.end_time > -1){
                            throw new Error('BAD COMMAND: End Display!');
                        }
                        this.data.end_time = this.data.start_time + curCtrl.delay;
                        break;
                    case 0x03: // SET_COLOR
                        // e2 e1   p b
                        // 0   background (B)
                        // 1   pattern (P)
                        // 2   emphasis 1 (E1)
                        // 3   emphasis 1 (E2)
                        const cmd3data = cmdBuf.readUInt16BE(cmdOffset);
                        
                        if(this.index.palette){
                            this.data.palette = {
                                b:  this.index.palette[cmd3data & 0xF],
                                p:  this.index.palette[cmd3data >> 4 & 0xF],
                                e1: this.index.palette[cmd3data >> 8 & 0xF],
                                e2: this.index.palette[cmd3data >> 12 & 0xF],
                            };
                        }
                        else{
                            this.data.palette = {
                                b:  { r: 0, g: 0, b: 0 },
                                p:  { r: 255, g: 255, b: 255 },
                                e1: { r: 255, g: 255, b: 255 },
                                e2: { r: 0, g: 0, b: 0 },
                            };
                        }
                        
                        cmdOffset += 2;
                        break;
                    case 0x04: // SET_CONTR
                        // 0x0 = transparent, 0xF = opaque
                        const cmd4data = cmdBuf.readUInt16BE(cmdOffset);
                        this.data.alpha = {
                            b:  cmd4data & 0xF,
                            p:  cmd4data >> 4 & 0xF,
                            e1: cmd4data >> 8 & 0xF,
                            e2: cmd4data >> 12 & 0xF,
                        };
                        
                        cmdOffset += 2;
                        break;
                    case 0x05: // SET_DAREA
                        // sx sx   sx ex   ex ex   sy sy   sy ey   ey ey
                        // sx = starting X coordinate
                        // ex = ending X coordinate
                        // sy = starting Y coordinate
                        // ey = ending Y coordinate
                        const x = cmdBuf.readUIntBE(cmdOffset, 3);
                        const y = cmdBuf.readUIntBE(cmdOffset + 3, 3);
                        
                        this.data.pos = {
                            left:   x >> 12,
                            right:  x & 0xFFF,
                            top:    y >> 12,
                            bottom: y & 0xFFF,
                        };
                        
                        if(this.data.pos.right < this.data.pos.left || this.data.pos.bottom < this.data.pos.top){
                            throw new Error('[BAD] Invalid Bounding Box');
                        }
                        
                        this.data.size = {};
                        this.data.size.width = this.data.pos.right - this.data.pos.left + 1;
                        this.data.size.height = this.data.pos.bottom - this.data.pos.top + 1;
                        
                        cmdOffset += 6;
                        break;
                    case 0x06: // SET_DSPXA
                        const PXDtfOffset = cmdBuf.readUInt16BE(cmdOffset);
                        const PXDbfOffset = cmdBuf.readUInt16BE(cmdOffset + 2);
                        
                        PXDtf = this.buffer.subarray(PXDtfOffset);
                        PXDbf = this.buffer.subarray(PXDbfOffset);
                        
                        cmdOffset += 4;
                        break;
                    case 0x07: // CHG_COLCON
                        throw new Error('COMMAND 0x07 NOT IMPLEMENTED!');
                        break;
                    case 0xFF: // CMD_END
                        cmdOffset = curCtrl.commands.length;
                        break;
                    default: // CMD_UNK
                        throw new Error('BAD COMMAND!');
                }
            }
            ctrlIndex++;
        }
        
        // check end delay
        const maxDelay = 8000;
        if(this.data.end_time < 0 && this.nextParagraph.timestamp){
            // console.warn('Warn: End Time fixed');
            this.data.end_time = this.nextParagraph.timestamp - 24;
        }
        if(this.data.start_time + maxDelay < this.data.end_time || this.data.end_time < 0){
            // console.warn('Warn: End Time trimmed');
            this.data.end_time = this.data.start_time + maxDelay;
        }
        
        // extract pixels
        this.data.rle = { tf: PXDtf, bf: PXDbf };
        
        // cleanup
        delete this.data.pts;
        
        // return parsed frame data
        return this.data;
        */
    }
}

class Index {
    constructor(lines) {
        this.params = {};
        this.languages = [];
        this.paragraphs = [];
        this._parseLines(lines.split('\n'));
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
                this.languages.push({ index: stream_index, id: language_id, title: language_name });
            }
            
            if(timeCodeLP.test(line)){
                const [ h, m, s, ms, filepos ] = Object.entries(line.match(timeCodeLP).groups).map(v => {
                    return parseInt(v[1], v[0] == 'filepos' ? 16 : 10);
                });
                const timestamp = (h * 3600 + m * 60 + s) * 1000 + ms;
                this.paragraphs.push({ stream_index, timestamp, filepos });
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
