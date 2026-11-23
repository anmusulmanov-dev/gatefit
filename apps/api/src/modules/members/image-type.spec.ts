import { imageType } from './image-type';

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
