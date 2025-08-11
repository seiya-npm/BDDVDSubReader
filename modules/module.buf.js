export default class BufferReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }
    readUInt8() {
        return this.buffer.readUInt8(this.offset++);
    }
    readUInt16BE() {
        const val = this.buffer.readUInt16BE(this.offset);
        this.offset += 2;
        return val;
    }
    readUInt24BE() {
        const val = this.buffer.readUIntBE(this.offset, 3); 
        this.offset += 3;
        return val;
    }
    readUInt32BE() {
        const val = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return val;
    }
    readBytes(length) {
        const val = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return val;
    }
    readString(length) {
        const val = this.buffer.toString('ascii', this.offset, this.offset + length);
        this.offset += length;
        return val;
    }
    seek(pos) {
        this.offset = pos;
    }
    tell() {
        return this.offset;
    }
    size() {
        return this.buffer.length;
    }
    remaining(){
        return this.buffer.length - this.offset;
    }
    skip(n) {
        this.offset += n;
    }
}
