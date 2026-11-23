import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { HttpError } from '../src/clothes/drying';
import { FIRMWARE_MAX_BYTES, otaCommand, parseFirmwareImage, parseFirmwareReport, parseRolloutTarget } from '../src/clothes/firmware';
import { clothesRoute } from '../src/routes/clothes';

const status = (fn: () => unknown) => { try { fn(); return 0; } catch (error) { return error instanceof HttpError ? error.status : -1; } };
const SHA = 'ab'.repeat(32);
const ID = '11111111-1111-4111-8111-111111111111';

// The start of an ESP-IDF app image: image header, first segment header, then esp_app_desc_t.
function image(chip = 9, size = 4096) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0xE9;
  view.setUint16(12, chip, true);
  view.setUint32(32, 0xABCD5432, true);
  const put = (at: number, text: string) => [...text].forEach((ch, i) => { bytes[at + i] = ch.charCodeAt(0); });
  put(48, '0.4.0'); put(80, 'hx711_scale'); put(112, '16:21:07'); put(128, 'Nov 22 2026');
  bytes.fill(0xAB, 176, 208);
  return bytes;
}

describe('Firmware image', () => {
  it('reads the version, build time and ELF hash from the image header', () => {
    expect(parseFirmwareImage(image())).toEqual({ version: '0.4.0', project: 'hx711_scale', built: 'Nov 22 2026 16:21:07', elf_sha: SHA });
  });
  it('rejects files that are not an ESP32-S3 app image', () => {
    const noMagic = image(); noMagic[0] = 0;
    const noDesc = image(); noDesc[32] = 0;
    for (const bytes of [noMagic, noDesc, image(5), image().subarray(0, 100), new Uint8Array(FIRMWARE_MAX_BYTES + 1)]) {
      expect(status(() => parseFirmwareImage(bytes))).toBe(400);
    }
  });
});

describe('Firmware messages', () => {
  it('builds the retained command a clip reads when it wakes', () => {
    expect(JSON.parse(otaCommand({ id: ID, elf_sha: SHA, size: 1105920, token: 'abc' }))).toEqual({
      sha: SHA, size: 1105920, port: 8088, path: `/api/v1/clothes/firmware/${ID}/image?token=abc`,
    });
  });
  it('uses a dedicated LAN host for firmware downloads', () => {
    const previousHost = process.env.FIRMWARE_HTTP_HOST;
    process.env.FIRMWARE_HTTP_HOST = '192.168.1.109';
    try {
      expect(JSON.parse(otaCommand({ id: ID, elf_sha: SHA, size: 1105920, token: 'abc' }))).toMatchObject({
        host: '192.168.1.109', port: 8088,
      });
      process.env.FIRMWARE_HTTP_HOST = 'http://invalid/path';
      expect(() => otaCommand({ id: ID, elf_sha: SHA, size: 1105920, token: 'abc' })).toThrow();
    } finally {
      if (previousHost === undefined) delete process.env.FIRMWARE_HTTP_HOST;
      else process.env.FIRMWARE_HTTP_HOST = previousHost;
    }
  });
  it('accepts clip reports and ignores anything else', () => {
    expect(parseFirmwareReport(JSON.stringify({ version: '0.4.0', sha: SHA, state: 'running' })))
      .toEqual({ version: '0.4.0', sha: SHA, state: 'running', progress: 0, target: null, detail: null });
    expect(parseFirmwareReport(JSON.stringify({ version: '0.3.0', sha: SHA, state: 'downloading', progress: 140, target: SHA }))?.progress).toBe(100);
    for (const text of ['', '{broken', '[]', '{"sha":"short","state":"running"}', JSON.stringify({ sha: SHA, state: 'flying' })]) {
      expect(parseFirmwareReport(text)).toBeNull();
    }
  });
  it('accepts "all" or a list of clip ids as the rollout target', () => {
    expect(parseRolloutTarget({ clip_ids: 'all' })).toBe('all');
    expect(parseRolloutTarget({ clip_ids: [ID, ID] })).toEqual([ID]);
    for (const body of [null, {}, { clip_ids: [] }, { clip_ids: ['c1'] }, { clip_ids: 'some' }]) {
      expect(status(() => parseRolloutTarget(body))).toBe(400);
    }
  });
});

describe('Firmware API without a database', () => {
  const app = new Hono().route('/clothes', clothesRoute);
  const upload = (bytes: Uint8Array) => {
    const form = new FormData();
    form.set('file', new File([bytes], 'hx711_scale.bin'));
    return app.request('/clothes/firmware', { method: 'POST', body: form });
  };
  const json = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  it('answers 503 instead of pretending to succeed', async () => {
    expect((await app.request('/clothes/firmware')).status).toBe(503);
    expect((await upload(image())).status).toBe(503);
    expect((await json(`/clothes/firmware/${ID}/rollout`, { clip_ids: 'all' })).status).toBe(503);
    expect((await json(`/clothes/firmware/jobs/${ID}/cancel`, {})).status).toBe(503);
    expect((await app.request(`/clothes/firmware/${ID}/image?token=x`)).status).toBe(503);
  });
  it('rejects bad input before touching the database', async () => {
    expect((await upload(image(5))).status).toBe(400);
    expect((await app.request('/clothes/firmware', { method: 'POST', body: 'not a form' })).status).toBe(400);
    expect((await json(`/clothes/firmware/${ID}/rollout`, { clip_ids: [] })).status).toBe(400);
    expect((await json('/clothes/firmware/c1/rollout', { clip_ids: 'all' })).status).toBe(404);
    expect((await json('/clothes/firmware/jobs/j1/cancel', {})).status).toBe(404);
    expect((await app.request('/clothes/firmware/c1/image?token=x')).status).toBe(404);
  });
});
