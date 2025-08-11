BDDVDSubReader

[![npm](https://img.shields.io/npm/v/bddvdsubreader?style=flat-square)](https://npmjs.com/bddvdsubreader)
[![npm downloads](https://img.shields.io/npm/dm/bddvdsubreader?style=flat-square)](https://npmjs.com/bddvdsubreader)

Usage:
```javascript
import { VobSubReader, BDSupReader } from 'bddvdsubreader';

const vobSubData = new VobSubReader('MyVobSub Subtitles'); // Path to .sub/.idx files without extension
const bdSupData = new BDSupReader('My PGS Subtitles.sup'); // Path to .sup file
```
