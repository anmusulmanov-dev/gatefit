import { imageSize, imageType } from './image-type';

describe('imageType', () => {
  it('recognises JPEG, PNG and WebP by their bytes', () => {
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe('jpg');
    expect(
      imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension,
    ).toBe('png');
    expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))?.extension).toBe('webp');
  });

  it('refuses anything else', () => {
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageType(Buffer.from('GIF89a'))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('imageSize', () => {
  function png(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
    buffer.writeUInt32BE(13, 8);
    buffer.write('IHDR', 12, 'ascii');
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  }

  function jpeg(width: number, height: number): Buffer {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.alloc(11);
    sof.writeUInt16BE(0xffc0, 0);
    sof.writeUInt16BE(9, 2);
    sof[4] = 8;
    sof.writeUInt16BE(height, 5);
    sof.writeUInt16BE(width, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(4)]);
  }

  function webpX(width: number, height: number): Buffer {
    const buffer = Buffer.alloc(30);
    buffer.write('RIFF', 0, 'ascii');
    buffer.write('WEBPVP8X', 8, 'ascii');
    buffer.writeUIntLE(width - 1, 24, 3);
    buffer.writeUIntLE(height - 1, 27, 3);
    return buffer;
  }

  it('reads PNG, JPEG and WebP headers', () => {
    expect(imageSize(png(512, 256))).toEqual({ width: 512, height: 256 });
    expect(imageSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(webpX(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it('is null for a cut-off or unknown file', () => {
    expect(imageSize(png(10, 10).subarray(0, 20))).toBeNull();
    expect(imageSize(Buffer.from('GIF89a'))).toBeNull();
  });
});
