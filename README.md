BDDVDSubReader

[![npm](https://img.shields.io/npm/v/bddvdsubreader?style=flat-square)](https://npmjs.com/bddvdsubreader)
[![npm downloads](https://img.shields.io/npm/dm/bddvdsubreader?style=flat-square)](https://npmjs.com/bddvdsubreader)

Usage:
```javascript
import { VobSubReader, BDSupReader } from 'bddvdsubreader';

const vobSubData = new VobSubReader('MyVobSub Subtitles'); // Path to .sub/.idx files with or without extension
const bdSupData = new BDSupReader('My PGS Subtitles.sup'); // Path to .sup file
```

Output:
```
(Object) => {
    tracks: (Map) => { // Only for VobSub
        id: 'en', // Language Id
        title: 'English', // Language Name
    },
    frames: (Array) => {
        track_index: 0, // Frames from Track Index (Only for VobSub)
        forced: false, // if frame forced subtitle
        pts: 0, // show frame in milliseconds
        end: 0, // hide frame in milliseconds
        width: 1920, // frame width
        height: 1080, // frame height
        rgba: <RGBAImage class>, // RGBAImage class, get() will return RGBA buffer
    }
}
```