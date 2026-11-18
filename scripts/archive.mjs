import { writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
const table = Array.from({length:256}, (_,n) => {
  for (let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});
function crc32(data) {
  let crc=0xffffffff;
  for (const b of data) crc=(crc>>>8)^table[(crc^b)&255];
  return (crc^0xffffffff)>>>0;
}
export async function writeZip(path, entries) {
  const parts=[], directory=[];
  let offset=0;
  for (const [name, value] of entries) {
    const filename=Buffer.from(name), data=Buffer.from(value), packed=deflateRawSync(data);
    const header=Buffer.alloc(30), central=Buffer.alloc(46), crc=crc32(data);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x800,6); header.writeUInt16LE(8,8); header.writeUInt16LE(33,12);
    header.writeUInt32LE(crc,14); header.writeUInt32LE(packed.length,18);
    header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
    central.writeUInt16LE(0x800,8); central.writeUInt16LE(8,10); central.writeUInt16LE(33,14);
    central.writeUInt32LE(crc,16); central.writeUInt32LE(packed.length,20);
    central.writeUInt32LE(data.length,24); central.writeUInt16LE(filename.length,28);
    central.writeUInt32LE(offset,42);
    parts.push(header,filename,packed); directory.push(central,filename);
    offset+=header.length+filename.length+packed.length;
  }
  const dir=Buffer.concat(directory), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(dir.length,12); end.writeUInt32LE(offset,16);
  await writeFile(path,Buffer.concat([...parts,dir,end]));
}
