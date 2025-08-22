// Value    Bits   n=length, c=color
// 1-3      4      n n c c
// 4-15     8      0 0 n n n n c c
// 16-63    12     0 0 0 0 n n n n | n n c c
// 64-255   16     0 0 0 0 0 0 n n | n n n n n n c c

const b16 = 0b11111100;
const b12 = 0b11110000;
const b8 = 0b11000000;

const col = ['b', 'p', 'e1', 'e2'];

class SPUImage {
    constructor(width, height) {
        this._width = width;
        this._height = height;
    }
    
    setPalette(palette, alpha) {
        this._palette = palette;
        this._alpha = alpha;
    }
    
    _parseRle(buffer, offset, half) {
        const data = buffer.readUIntBE(offset, 3);
        let group = (half ? data >> 4 : data >> 8) & 0xffff;
        const byte = group >> 8;
        let is16 = false;
        
        // dsize half +offset
        // 1     1     0
        // 1     0     1
        // 2     0     1
        // 2     1     1
        // 3     1     1
        // 3     0     2
        // 4     0     2
        // 4     1     2
        
        if ((byte & b16) === 0) {
            is16 = true;
            offset += 2;
        }
        else if ((byte & b12) === 0) {
            half = !half;
            group = group >> 4;
            offset += 1 + !half;
        }
        else if ((byte & b8) === 0) {
            group = group >> 8;
            offset += 1;
        }
        else {
            half = !half;
            group = group >> 12;
            offset += !half;
        }
        
        const color = group & 0b11;
        let size = group >> 2;
        
        if (size === 0) {
            if (is16) {
                size = -1;
            }
            else {
                throw new Error('Invalid RLE group size');
            }
        }
        
        if (color > 3) {
            throw new Error('Invalid RLE color');
        }
        
        return { size, color, half, offset };
    }
    
    _scanLine(line_index, input, length) {
        let x = 0;
        let offset = 0;
        let half = false;
    
        while (x < length) {
            const data = this._parseRle(input, offset, half);
            // console.log(data);
            offset = data.offset;
            half = data.half;
            
            const count = data.size < 0 ? length - x : data.size;
            if (x + count > length) {
                throw new Error('Scan line is too long');
            }
            
            const color = col[data.color];
            if(this._alpha[color] != 0){
                this._lines.push({ line_index, start: x, length: count, color });
            }
            
            x += count;
        }
        
        if (x > length) {
            throw new Error('Decoded scan line is too long');
        }
        
        return offset + half;
    }
    
    decompressRLEImage(PXDtf, PXDbf) {
        this._lines = [];
        
        const data = [PXDtf, PXDbf];
        const offsets = [0, 0];
        let curLine = 0;
        
        while(curLine < this._height){
            const odd = curLine % 2;
            
            const consumed = this._scanLine(
                curLine,
                data[odd].subarray(offsets[odd]),
                this._width * this._height,
            );
            
            offsets[odd] += consumed;
            
            curLine++;
        }
    }
    
    getPxData() {
        const pixelData = Buffer.alloc(this._width * this._height * 4);
        const color = Buffer.alloc(4);
        let row = 0;
        
        while(row < this._lines.length){
            const row_data = this._lines[row];
            const offset = ((row_data.line_index * this._width) + row_data.start);
            const length = row_data.length;
            
            const c = this._palette[row_data.color];
            const a = this._alpha[row_data.color] * 0x11;
            color.set([c.r, c.g, c.b, a]);
            
            pixelData.fill(color, offset * 4, (offset + length) * 4)
            
            row++;
        }
        
        return pixelData;
    }
}

export default class RGBAImage {
    #width;
    #height;
    #palette;
    #alpha;
    #PXDtf;
    #PXDbf;
    
    constructor(w, h, p, a, PXDtf, PXDbf) {
        this.#width = w;
        this.#height = h;
        this.#palette = p;
        this.#alpha = a;
        this.#PXDtf = PXDtf;
        this.#PXDbf = PXDbf;
    }
    
    get(){
        const pic = new SPUImage(this.#width, this.#height);
        pic.setPalette(this.#palette, this.#alpha);
        pic.decompressRLEImage(this.#PXDtf, this.#PXDbf);
        return pic.getPxData();
    }
}
