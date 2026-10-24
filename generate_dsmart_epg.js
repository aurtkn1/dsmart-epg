
"use strict";

const fs = require("fs");
const path = require("path");

const API_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules";

const LEGACY_CHANNELS_URL =
  "https://www.dsmart.com.tr/actions/channels?page=1&limit=500";

const LEGACY_SCHEDULE_URL =
  "https://www.dsmart.com.tr/actions/schedule";

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml");
const TEMP_FILE = path.join(__dirname, "dsmart.xml.tmp");

const DAYS = 7;
const PAGE_LIMIT = 10;
const REQUEST_DELAY = 300;
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.dsmart.com.tr/yayin-akisi",
  "Origin": "https://www.dsmart.com.tr"
};

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function asText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function firstValue(object, keys) {
  if (!object || typeof object !== "object") return null;

  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return null;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getDays() {
  const result = [];
  const now = new Date();

  for (let i = 0; i < DAYS; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() + i);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    result.push(`${year}-${month}-${day}`);
  }

  return result;
}

function getChannelId(channel) {
  return asText(firstValue(channel, [
    "_id",
    "id",
    "channel_id",
    "channelId",
    "site_id"
  ]));
}

function getChannelName(channel) {
  return asText(firstValue(channel, [
    "channel_name",
    "name",
    "channelName",
    "title",
    "display_name"
  ]));
}

function getProgramTitle(program) {
  return asText(firstValue(program, [
    "program_name",
    "title",
    "name",
    "programName",
    "event_name"
  ]));
}

function getDescription(program) {
  return asText(firstValue(program, [
    "description",
    "summary",
    "synopsis"
  ]));
}

function parseDuration(value) {
  if (value === null || value === undefined) return 0;

  let input = String(value).trim();

  // Bazı D-Smart kayıtlarında süre "tarih, HH:mm:ss" biçimindedir.
  if (input.includes(",")) {
    input = input.split(",").pop().trim();
  }

  const parts = input.split(":").map(Number);

  if (
    parts.length !== 3 ||
    parts.some(n => !Number.isFinite(n) || n < 0)
  ) {
    return 0;
  }

  return (
    parts[0] * 3600 +
    parts[1] * 60 +
    parts[2]
  ) * 1000;
}

function parseDate(value, day) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    const ms = value < 10000000000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const input = String(value).trim();

  if (/^\d{10,13}$/.test(input)) {
    const number = Number(input);
    const ms = number < 10000000000 ? number * 1000 : number;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  let normalized = input;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(normalized)) {
    normalized = `${day}T${normalized}`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d/.test(normalized)) {
    normalized = normalized.replace(" ", "T");
  }

  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function xmltvTime(date) {
  const pad = n => String(n).padStart(2, "0");

  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);

  return (
    `${date.getFullYear()}` +
    `${pad(date.getMonth() + 1)}` +
    `${pad(date.getDate())}` +
    `${pad(date.getHours())}` +
    `${pad(date.getMinutes())}` +
    `${pad(date.getSeconds())} ` +
    `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
  );
}

async function fetchJson(url) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

    try {
      console.log(`GET ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: HEADERS,
        signal: controller.signal
      });

      const body = await response.text();

      if (!response.ok) {
        const preview = body
          .replace(/\s+/g, " ")
          .slice(0, 400);

        const error = new Error(
          `HTTP ${response.status} — ${url}` +
          (preview ? ` | Yanıt: ${preview}` : "")
        );

        error.status = response.status;

        if (
          response.status === 400 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404
        ) {
          throw error;
        }

        throw error;
      }

      try {
        return JSON.parse(body);
      } catch {
        throw new Error(
          `Sunucu JSON döndürmedi: ${url} | ` +
          body.replace(/\s+/g, " ").slice(0, 300)
        );
      }
    } catch (error) {
      lastError = error;

      console.error(error.message);

      if (error.status) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 1500);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("İstek başarısız.");
}

function extractModernChannels(data) {
  if (Array.isArray(data?.data?.channels)) {
    return data.data.channels;
  }

  if (Array.isArray(data?.channels)) {
    return data.channels;
  }

  return [];
}

function normalizeProgram(program, day) {
  const title = getProgramTitle(program);
  if (!title) return null;

  const rawStart = firstValue(program, [
    "start_date",
    "startDate",
    "start_time",
    "startTime",
    "start",
    "begin"
  ]);

  const start = parseDate(rawStart, day);
  if (!start) return null;

  const rawStop = firstValue(program, [
    "end_date",
    "endDate",
    "end_time",
    "endTime",
    "stop",
    "end"
  ]);

  let stop = parseDate(rawStop, day);

  if (!stop || stop <= start) {
    const duration = parseDuration(
      firstValue(program, ["duration", "length", "runtime"])
    );

    if (duration > 0) {
      stop = new Date(start.getTime() + duration);
    }
  }

  if (!stop || stop <= start) return null;

  return {
    title,
    description: getDescription(program),
    start,
    stop
  };
}

function extractSchedule(channel, day) {
  const schedule = Array.isArray(channel?.schedule)
    ? channel.schedule
    : [];

  const result = [];

  for (const item of schedule) {
    const title = getProgramTitle(item);
    if (!title) continue;

    // D-Smart'ın bilinen yapısında start_date ve duration bulunur.
    const start = parseDate(item.start_date, day);

    if (!start) {
      console.log(
        `UYARI: Başlangıç zamanı çözümlenemedi: ${title}`
      );
      continue;
    }

    const duration = parseDuration(item.duration);
    if (duration <= 0) continue;

    result.push({
      title,
      description: getDescription(item),
      start,
      stop: new Date(start.getTime() + duration)
    });
  }

  return result;
}

async function fetchModernDay(day) {
  const allChannels = new Map();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = new URL(API_URL);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("day", day);

    const data = await fetchJson(url.toString());
    const items = extractModernChannels(data);

    if (page === 1 && items.length === 0) {
      throw new Error(
        "API yanıtında data.channels bulunamadı."
      );
    }

    for (const channel of items) {
      const id = getChannelId(channel);
      const name = getChannelName(channel);
      const key = id || name;

      if (key && !allChannels.has(key)) {
        allChannels.set(key, channel);
      }
    }

    const total = Number(data?.data?.total || 0);
    totalPages = total > 0
      ? Math.ceil(total / PAGE_LIMIT)
      : (items.length >= PAGE_LIMIT ? page + 1 : page);

    if (page >= totalPages) break;

    page++;
    await sleep(REQUEST_DELAY);
  }

  const result = [];

  for (const channel of allChannels.values()) {
    const id = getChannelId(channel);
    const name = getChannelName(channel);
    const programs = extractSchedule(channel, day);

    if (id && name && programs.length) {
      result.push({ id, name, programs });
    }
  }

  return result;
}

function extractLegacyChannels(data) {
  const candidates = [
    data?.data?.channels,
    data?.channels,
    data?.data?.items,
    data?.items,
    data?.data,
    data
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function extractLegacyPrograms(data, day) {
  const candidates = [
    data?.data?.schedule,
    data?.data?.schedules,
    data?.data?.programs,
    data?.data?.items,
    data?.schedule,
    data?.schedules,
    data?.programs,
    data?.items,
    data?.data,
    data
  ];

  let items = [];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      items = candidate;
      break;
    }
  }

  const result = [];

  for (const item of items) {
    const program = normalizeProgram(item, day);

    if (program) {
      result.push(program);
    } else if (
      item &&
      typeof item === "object" &&
      Array.isArray(item.schedule)
    ) {
      result.push(...extractSchedule(item, day));
    }
  }

  return result;
}

async function fetchLegacyChannels() {
  console.log("Eski API deneniyor: /actions/channels");

  const data = await fetchJson(LEGACY_CHANNELS_URL);
  const channels = extractLegacyChannels(data);

  if (!channels.length) {
    throw new Error(
      "Eski API yanıtında kanal listesi bulunamadı."
    );
  }

  return channels.filter(channel =>
    getChannelId(channel) && getChannelName(channel)
  );
}

async function fetchLegacyDay(day, channels) {
  const result = [];

  for (const channel of channels) {
    const id = getChannelId(channel);
    const name = getChannelName(channel);

    if (!id || !name) continue;

    const url = new URL(LEGACY_SCHEDULE_URL);
    url.searchParams.set("channel_id", id);

    try {
      const data = await fetchJson(url.toString());
      const programs = extractLegacyPrograms(data, day);

      if (programs.length) {
        result.push({ id, name, programs });
      }
    } catch (error) {
      console.error(
        `Eski API kanal hatası (${name}): ${error.message}`
      );
    }

    await sleep(REQUEST_DELAY);
  }

  return result;
}

function mergeChannels(destination, source) {
  for (const channel of source) {
    if (!channel.id || !channel.name) continue;

    if (!destination.has(channel.id)) {
      destination.set(channel.id, {
        id: channel.id,
        name: channel.name,
        programs: new Map()
      });
    }

    const target = destination.get(channel.id);

    for (const program of channel.programs) {
      const key =
        `${program.title}|${program.start.toISOString()}`;

      if (!target.programs.has(key)) {
        target.programs.set(key, program);
      }
    }
  }
}

function buildXml(channels) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="D-Smart EPG">'
  ];

  const validChannels = channels.filter(
    channel => channel.programs.length > 0
  );

  for (const channel of validChannels) {
    lines.push(
      `  <channel id="${escapeXml(channel.id)}">`,
      `    <display-name lang="tr">${escapeXml(channel.name)}</display-name>`,
      "  </channel>"
    );
  }

  for (const channel of validChannels) {
    const programs = [...channel.programs.values()].sort(
      (a, b) => a.start - b.start
    );

    for (const program of programs) {
      lines.push(
        `  <programme start="${xmltvTime(program.start)}" stop="${xmltvTime(program.stop)}" channel="${escapeXml(channel.id)}">`,
        `    <title lang="tr">${escapeXml(program.title)}</title>`
      );

      if (program.description) {
        lines.push(
          `    <desc lang="tr">${escapeXml(program.description)}</desc>`
        );
      }

      lines.push("  </programme>");
    }
  }

  lines.push("</tv>", "");

  return lines.join("\n");
}

async function main() {
  console.log("======================================");
  console.log("D-SMART EPG BAŞLADI");
  console.log("======================================");

  const days = getDays();
  const channelsMap = new Map();

  let modernWorked = false;
  let legacyChannels = null;

  for (const day of days) {
    console.log("");
    console.log(`Tarih: ${day}`);

    try {
      const channels = await fetchModernDay(day);

      if (channels.length) {
        modernWorked = true;
        mergeChannels(channelsMap, channels);
        console.log(`${day}: ${channels.length} kanal alındı.`);
      } else {
        console.log(`${day}: Program bulunamadı.`);
      }
    } catch (error) {
      console.error(`Güncel API başarısız: ${error.message}`);

      if (!legacyChannels) {
        try {
          legacyChannels = await fetchLegacyChannels();
          console.log(
            `Eski API kanal sayısı: ${legacyChannels.length}`
          );
        } catch (legacyError) {
          console.error(
            `Eski kanal API'si de başarısız: ${legacyError.message}`
          );
          break;
        }
      }

      try {
        const channels = await fetchLegacyDay(day, legacyChannels);
        mergeChannels(channelsMap, channels);

        console.log(
          `${day}: Eski API'den ${channels.length} kanal alındı.`
        );
      } catch (legacyError) {
        console.error(
          `${day}: Eski API de başarısız: ${legacyError.message}`
        );
      }
    }

    await sleep(REQUEST_DELAY);
  }

  const channels = [...channelsMap.values()];
  const programCount = channels.reduce(
    (sum, channel) => sum + channel.programs.size,
    0
  );

  console.log("");
  console.log(`Kanal sayısı: ${channels.length}`);
  console.log(`Program sayısı: ${programCount}`);

  if (programCount === 0) {
    throw new Error(
      "Hiç program alınamadı. İki API adresi de erişim engeli veriyor olabilir. Mevcut dsmart.xml korunuyor."
    );
  }

  const xml = buildXml(channels);

  if (
    !xml.includes("<programme ") ||
    !xml.includes("</tv>")
  ) {
    throw new Error(
      "XML kontrolü başarısız. Mevcut dosya korunuyor."
    );
  }

  fs.writeFileSync(TEMP_FILE, xml, "utf8");

  const verify = fs.readFileSync(TEMP_FILE, "utf8");

  if (!verify.includes("<programme ")) {
    fs.unlinkSync(TEMP_FILE);
    throw new Error(
      "Geçici XML doğrulanamadı. Mevcut dosya korunuyor."
    );
  }

  fs.renameSync(TEMP_FILE, OUTPUT_FILE);

  console.log("EPG başarıyla oluşturuldu.");
  console.log(`Dosya boyutu: ${fs.statSync(OUTPUT_FILE).size} bayt`);
}

main().catch(error => {
  console.error("");
  console.error("D-SMART EPG HATASI:");
  console.error(error.message);
  console.error("Mevcut dsmart.xml korunuyor.");
  process.exitCode = 1;
});
