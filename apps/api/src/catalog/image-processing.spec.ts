import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { crc32, deflateSync } from 'node:zlib';
import { detectImageType, processImage } from './image-processing';

// A plain photo, made here, so the tests need no image files.
function photo(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp' = 'jpeg',
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#4a8c5a' },
  })
    .toFormat(format)
    .toBuffer();
}

// A PNG whose header claims a size its few bytes cannot hold.
function pngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(10))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The message a refused image answers with.
async function refusal(promise: Promise<unknown>): Promise<string> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  const response = (error as BadRequestException).getResponse() as {
    message: string;
    errors: { field: string; message: string }[];
  };
  expect(response.message).toBe('Validation failed');
  expect(response.errors).toHaveLength(1);
  expect(response.errors[0].field).toBe('image');
  return response.errors[0].message;
}

describe('detectImageType', () => {
  it('knows JPEG, PNG and WebP by their first bytes', async () => {
    expect(detectImageType(await photo(10, 10, 'jpeg'))).toBe('image/jpeg');
    expect(detectImageType(await photo(10, 10, 'png'))).toBe('image/png');
    expect(detectImageType(await photo(10, 10, 'webp'))).toBe('image/webp');
  });

  it('knows nothing else, whatever a file is called', () => {
    const others = [
      Buffer.from('GIF89a'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from('RIFF\0\0\0\0WAVEfmt '),
      Buffer.from([0xff, 0xd8]),
      Buffer.alloc(0),
    ];
    for (const file of others) {
      expect(detectImageType(file)).toBeNull();
    }
  });
});

describe('processImage', () => {
  it('makes a large and a small WebP file, at most 1600 and 400 pixels on the longest side', async () => {
    const result = await processImage(await photo(2400, 1200, 'png'), 'image/png');

    expect([result.width, result.height]).toEqual([1600, 800]);
    expect(detectImageType(result.large)).toBe('image/webp');
    expect(detectImageType(result.small)).toBe('image/webp');
    const large = await sharp(result.large).metadata();
    const small = await sharp(result.small).metadata();
    expect([large.width, large.height]).toEqual([1600, 800]);
    expect([small.width, small.height]).toEqual([400, 200]);
  });

  it('never enlarges a smaller photo, and takes all three types', async () => {
    const jpeg = await processImage(await photo(800, 600), 'image/jpeg');
    expect([jpeg.width, jpeg.height]).toEqual([800, 600]);
    const small = await sharp(jpeg.small).metadata();
    expect([small.width, small.height]).toEqual([400, 300]);

    const webp = await processImage(await photo(500, 400, 'webp'), 'image/webp');
    expect([webp.width, webp.height]).toEqual([500, 400]);
  });

  it('turns a photo upright, and keeps none of its hidden details', async () => {
    // A portrait photo stored lying on its side, as phones do, with a note
    // where a phone would put its GPS location.
    const sideways = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#4a8c5a' },
    })
      .jpeg()
      .withExif({ IFD0: { ImageDescription: 'Taken at 12.97N 77.59E' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processImage(sideways, 'image/jpeg');

    expect([result.width, result.height]).toEqual([600, 800]);
    for (const file of [result.large, result.small]) {
      const metadata = await sharp(file).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    }
  });

  it('refuses a file that is not the type its Content-Type says', async () => {
    await expect(
      refusal(processImage(await photo(500, 500, 'png'), 'image/jpeg')),
    ).resolves.toBe('The file is not a JPEG image');
    await expect(
      refusal(processImage(Buffer.from('<svg></svg>'), 'image/png')),
    ).resolves.toBe('The file is not a PNG image');
    await expect(
      refusal(processImage(await photo(500, 500, 'jpeg'), 'image/webp')),
    ).resolves.toBe('The file is not a WebP image');
  });

  it('refuses a damaged file, or one cut short', async () => {
    const damaged = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(200, 7),
    ]);
    const whole = await photo(800, 600);
    const cutShort = whole.subarray(0, Math.floor(whole.length / 2));

    for (const file of [damaged, cutShort]) {
      await expect(refusal(processImage(file, 'image/jpeg'))).resolves.toBe(
        'The image could not be read. It may be damaged.',
      );
    }
  });

  it('wants at least 400 pixels on each side', async () => {
    for (const [width, height] of [
      [399, 800],
      [800, 399],
    ]) {
      await expect(
        refusal(processImage(await photo(width, height), 'image/jpeg')),
      ).resolves.toBe('The image needs at least 400 pixels on each side');
    }
    await expect(
      processImage(await photo(400, 400), 'image/jpeg'),
    ).resolves.toMatchObject({ width: 400, height: 400 });
  });

  it('refuses more than 50 megapixels from the header alone, before decoding anything', async () => {
    // 68 bytes that claim 100 megapixels: a decompression bomb.
    await expect(
      refusal(processImage(pngClaiming(10_000, 10_000), 'image/png')),
    ).resolves.toBe('The image may have at most 50 megapixels');
    // Just over the limit: 7072 x 7072 is 50,013,184 pixels.
    await expect(
      refusal(processImage(pngClaiming(7072, 7072), 'image/png')),
    ).resolves.toBe('The image may have at most 50 megapixels');
    // Exactly 50 megapixels passes this check; these few bytes then cannot
    // be read as an image.
    await expect(
      refusal(processImage(pngClaiming(10_000, 5000), 'image/png')),
    ).resolves.toBe('The image could not be read. It may be damaged.');
  });
});
