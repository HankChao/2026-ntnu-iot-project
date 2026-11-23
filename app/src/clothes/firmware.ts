// Over-the-air firmware updates for the clips.
//
// The dashboard uploads an ESP-IDF app image; it is stored in PostgreSQL. A rollout creates one job
// per clip and leaves a retained command on the clip's `clothes/<id>/ota`. A clip sleeps between
// reports, so it only sees the command the next time it wakes; it then downloads the image over HTTP
// from this server (GET .../firmware/:id/image?token=), reboots into it and reports on `clothes/<id>/fw`.
// Clips on firmware before 0.5.0 use `<CLOTHES_MQTT_TOPIC>/ota` and `/fw` instead (LEGACY_TOPIC).
// A clip is identified as "running image X" by the ELF SHA-256 inside the image, not by its
// version text, so forgetting to bump the version cannot hide an update.
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { dbClient } from '../db/client';
import { mqttPublisher } from '../mqtt/publisher';
import { HttpError } from './drying';
import { LEGACY_TOPIC, clipIdForDevice, clipTopic, defaultClipId, isUuid } from './store';

export const FIRMWARE_MAX_BYTES = 3 * 1024 * 1024;  // one OTA slot (see firmware partitions.csv)
// Port the clips use to reach this server's HTTP API: nginx in the web container.
const DEVICE_HTTP_PORT = Number(process.env.FIRMWARE_HTTP_PORT) || 8088;
const HTTP_HOST = /^[A-Za-z0-9.-]{1,128}$/;
const ESP32_S3_CHIP_ID = 9;
const SHA = /^[0-9a-f]{64}$/;

export interface FirmwareInfo { version: string; project: string; built: string; elf_sha: string }

// Pure: reads esp_image_header_t and the esp_app_desc_t that follows the first segment header.
export function parseFirmwareImage(bytes: Uint8Array): FirmwareInfo {
  if (bytes.length > FIRMWARE_MAX_BYTES) throw new HttpError(400, `韌體檔超過 ${FIRMWARE_MAX_BYTES / 1048576} MB`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 288 || bytes[0] !== 0xE9 || view.getUint32(32, true) !== 0xABCD5432) {
    throw new HttpError(400, '這不是 ESP32 的應用程式韌體');
  }
  if (view.getUint16(12, true) !== ESP32_S3_CHIP_ID) throw new HttpError(400, '這個韌體不是給 ESP32-S3 的');
  const text = (from: number, length: number) => {
    let end = from;
    while (end < from + length && bytes[end] !== 0) end += 1;
    return new TextDecoder().decode(bytes.subarray(from, end)).replace(/[^\x20-\x7E]/g, '?');
  };
  return {
    version: text(48, 32) || '未標版本', project: text(80, 32), built: `${text(128, 16)} ${text(112, 16)}`.trim(),
    elf_sha: [...bytes.subarray(176, 208)].map((b) => b.toString(16).padStart(2, '0')).join(''),
  };
}

export type ReportState = 'running' | 'downloading' | 'failed';
export interface FirmwareReport { version: string; sha: string; state: ReportState; progress: number; target: string | null; detail: string | null }

// Pure: what a clip publishes on `<topic>/fw`. Null when the message is not a usable report.
export function parseFirmwareReport(text: string): FirmwareReport | null {
  let data: any;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || typeof data.sha !== 'string' || !SHA.test(data.sha)) return null;
  if (!['running', 'downloading', 'failed'].includes(data.state)) return null;
  const progress = Number.isInteger(data.progress) ? Math.min(100, Math.max(0, data.progress)) : 0;
  return {
    version: typeof data.version === 'string' ? data.version.slice(0, 32) : '',
    sha: data.sha, state: data.state, progress,
    target: typeof data.target === 'string' && SHA.test(data.target) ? data.target : null,
    detail: typeof data.detail === 'string' ? data.detail.slice(0, 120) : null,
  };
}

// Pure: the retained command a clip reads when it wakes.
export function otaCommand(image: { id: string; elf_sha: string; size: number; token: string }) {
  const configuredHost = process.env.FIRMWARE_HTTP_HOST?.trim();
  if (configuredHost && !HTTP_HOST.test(configuredHost)) throw new Error('FIRMWARE_HTTP_HOST is not a valid hostname or IPv4 address');
  return JSON.stringify({
    sha: image.elf_sha, size: image.size, port: DEVICE_HTTP_PORT,
    host: configuredHost || undefined,
    path: `/api/v1/clothes/firmware/${image.id}/image?token=${image.token}`,
  });
}

export function parseRolloutTarget(body: unknown): 'all' | string[] {
  const target = (body as { clip_ids?: unknown } | null)?.clip_ids;
  if (target === 'all') return 'all';
  if (Array.isArray(target) && target.length >= 1 && target.length <= 64 && target.every(isUuid)) return [...new Set(target)];
  throw new HttpError(400, 'clip_ids 必須是 "all" 或衣夾 id 陣列');
}

function database() {
  if (!dbClient.isConnected()) throw new Error('Database unavailable');
  return dbClient.sql;
}

// Needs the clips table (ensureDryingSchema) first.
export async function ensureFirmwareSchema(): Promise<void> {
  const sql = database();
  await sql`
    CREATE TABLE IF NOT EXISTS firmware_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename TEXT NOT NULL,
      version TEXT NOT NULL,
      project TEXT NOT NULL,
      built TEXT NOT NULL,
      elf_sha TEXT NOT NULL UNIQUE CHECK (elf_sha ~ '^[0-9a-f]{64}$'),
      size INTEGER NOT NULL CHECK (size > 0),
      token TEXT NOT NULL,
      data BYTEA NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS firmware_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clip_id UUID NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      image_id UUID NOT NULL REFERENCES firmware_images(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'downloading', 'done', 'failed', 'cancelled')),
      progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  // A clip has at most one update under way.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS firmware_jobs_one_active ON firmware_jobs (clip_id) WHERE state IN ('queued', 'downloading')`;
  // What each clip last said it is running.
  await sql`
    CREATE TABLE IF NOT EXISTS clip_firmware (
      clip_id UUID PRIMARY KEY REFERENCES clips(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      elf_sha TEXT NOT NULL,
      reported_at TIMESTAMPTZ NOT NULL
    )`;
}

export async function saveFirmwareImage(filename: string, bytes: Uint8Array) {
  const info = parseFirmwareImage(bytes);
  const sql = database();
  const name = filename.replace(/[^\w.\-]/g, '_').slice(0, 80) || 'firmware.bin';
  // bytea goes in and out as base64 so it does not depend on the driver's binary handling.
  const rows = await sql`
    INSERT INTO firmware_images (filename, version, project, built, elf_sha, size, token, data)
    VALUES (${name}, ${info.version}, ${info.project}, ${info.built}, ${info.elf_sha}, ${bytes.length},
            ${randomBytes(16).toString('hex')}, decode(${Buffer.from(bytes).toString('base64')}, 'base64'))
    ON CONFLICT (elf_sha) DO UPDATE SET filename = EXCLUDED.filename
    RETURNING id, filename, version, project, built, elf_sha, size, uploaded_at`;
  return rows[0];
}

export async function firmwareImageData(id: string, token: string): Promise<Buffer | null> {
  if (!isUuid(id)) return null;
  const rows = await database()`SELECT token, encode(data, 'base64') AS data FROM firmware_images WHERE id = ${id}::uuid`;
  if (!rows.length) return null;
  const expected = Buffer.from(rows[0].token);
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Buffer.from(rows[0].data.replace(/\s/g, ''), 'base64');
}

export async function firmwareState() {
  const sql = database();
  const images = await sql`
    SELECT id, filename, version, project, built, elf_sha, size, uploaded_at FROM firmware_images
    ORDER BY uploaded_at DESC LIMIT 20`;
  const jobs = await sql`
    SELECT j.id, j.clip_id, c.name AS clip_name, j.image_id, i.version, j.state, j.progress, j.detail, j.created_at, j.updated_at
    FROM firmware_jobs j JOIN clips c ON c.id = j.clip_id JOIN firmware_images i ON i.id = j.image_id
    ORDER BY j.created_at DESC LIMIT 40`;
  const clips = await sql`SELECT clip_id, version, elf_sha, reported_at FROM clip_firmware`;
  return { images, jobs, clips };
}

// Where a clip reads its command: its own topic once its device id is known, else the shared one.
const commandTopic = (deviceId: string | null) => deviceId ? clipTopic(deviceId, 'ota') : LEGACY_TOPIC ? `${LEGACY_TOPIC}/ota` : null;
// A clip updated from older firmware was told on the shared topic and answers on its own, so both are cleared.
async function clearCommand(deviceId: string | null) {
  if (deviceId) await mqttPublisher.publishRaw(clipTopic(deviceId, 'ota'), '', true);
  if (LEGACY_TOPIC) await mqttPublisher.publishRaw(`${LEGACY_TOPIC}/ota`, '', true);
}

// Queues the image for the chosen real clips (demo clips have no device behind them).
export async function startRollout(imageId: string, target: 'all' | string[]) {
  if (!isUuid(imageId)) throw new HttpError(404, '找不到這個韌體');
  const sql = database();
  const images = await sql`SELECT id, elf_sha, size, token FROM firmware_images WHERE id = ${imageId}::uuid`;
  if (!images.length) throw new HttpError(404, '找不到這個韌體');
  const image = images[0];
  const real = (await sql`
    SELECT c.id, c.device_id, f.elf_sha FROM clips c LEFT JOIN clip_firmware f ON f.clip_id = c.id
    WHERE NOT c.is_demo`).filter((clip: { device_id: string | null }) => commandTopic(clip.device_id));
  const chosen = target === 'all' ? real : real.filter((clip: { id: string }) => target.includes(clip.id));
  if (target !== 'all' && chosen.length !== target.length) throw new HttpError(400, '只能更新連線過的實體衣夾');
  if (!chosen.length) throw new HttpError(400, '沒有可以更新的實體衣夾（衣夾要先連線回報過一次）');
  if (!mqttPublisher.isConnected()) throw new Error('MQTT unavailable');
  let started = 0;
  let current = 0;
  for (const clip of chosen) {
    if (clip.elf_sha === image.elf_sha) { current += 1; continue; }  // already running this image
    await sql`UPDATE firmware_jobs SET state = 'cancelled', updated_at = now() WHERE clip_id = ${clip.id}::uuid AND state IN ('queued', 'downloading')`;
    await sql`INSERT INTO firmware_jobs (clip_id, image_id) VALUES (${clip.id}::uuid, ${image.id}::uuid)`;
    await mqttPublisher.publishRaw(commandTopic(clip.device_id)!, otaCommand(image), true);
    started += 1;
  }
  return { started, current };
}

export async function cancelFirmwareJob(jobId: string) {
  if (!isUuid(jobId)) throw new HttpError(404, '找不到這筆更新');
  const sql = database();
  const rows = await sql`
    UPDATE firmware_jobs j SET state = 'cancelled', updated_at = now() FROM clips c
    WHERE j.id = ${jobId}::uuid AND j.state = 'queued' AND c.id = j.clip_id RETURNING c.device_id`;
  if (!rows.length) {
    const exists = await sql`SELECT 1 FROM firmware_jobs WHERE id = ${jobId}::uuid`;
    throw exists.length ? new HttpError(409, '衣夾已經開始下載或更新已結束，無法取消') : new HttpError(404, '找不到這筆更新');
  }
  await clearCommand(rows[0].device_id);
}

// A clip's report on its `fw` topic: remembers what it runs and moves its job along.
// deviceId: the id in the topic; null for the shared topic of firmware before 0.5.0.
export async function ingestFirmwareReport(deviceId: string | null, text: string, now: Date): Promise<void> {
  const report = parseFirmwareReport(text);
  if (!report) return;
  const sql = database();
  const clipId = deviceId ? await clipIdForDevice(deviceId) : await defaultClipId();
  if (!clipId) return;
  await sql`
    INSERT INTO clip_firmware (clip_id, version, elf_sha, reported_at) VALUES (${clipId}::uuid, ${report.version}, ${report.sha}, ${now})
    ON CONFLICT (clip_id) DO UPDATE SET version = EXCLUDED.version, elf_sha = EXCLUDED.elf_sha, reported_at = EXCLUDED.reported_at`;
  const jobs = await sql`
    SELECT j.id, i.elf_sha FROM firmware_jobs j JOIN firmware_images i ON i.id = j.image_id
    WHERE j.clip_id = ${clipId}::uuid AND j.state IN ('queued', 'downloading')`;
  if (!jobs.length) return;
  const job = jobs[0];
  if (report.state === 'running' && report.sha === job.elf_sha) {
    await sql`UPDATE firmware_jobs SET state = 'done', progress = 100, detail = NULL, updated_at = ${now} WHERE id = ${job.id}::uuid`;
    await clearCommand(deviceId);
  } else if (report.state === 'downloading' && report.target === job.elf_sha) {
    await sql`UPDATE firmware_jobs SET state = 'downloading', progress = ${report.progress}, updated_at = ${now} WHERE id = ${job.id}::uuid`;
  } else if (report.state === 'failed' && report.target === job.elf_sha) {
    await sql`UPDATE firmware_jobs SET state = 'failed', detail = ${report.detail ?? '衣夾回報更新失敗'}, updated_at = ${now} WHERE id = ${job.id}::uuid`;
    await clearCommand(deviceId);
  }
}
