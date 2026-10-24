
"use strict";

const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules";

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml");
const TEMP_FILE = path.join(__dirname, "dsmart.xml.tmp");

const PAGE_LIMIT = 10;
const DAYS = 7;
const REQUEST_DELAY = 500;
const REQUEST_TIMEOUT = 20000;
const MAX_RETRIES = 4;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://www.dsmart.com.tr/",
  "Origin": "https://www.dsmart.com.tr",
  "Cache-Control": "no-cache"
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return "";
  return String(value).trim();
}

function first(object, keys) {
  if (!object || typeof object !== "object") return "";

  for (const key of keys) {
    const value = object[key];

    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return "";
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

function channelId(channel) {
  return text(first(channel, [
    "id",
    "_id",
    "channelId",
    "channel_id",
    "serviceId",
    "service_id",
    "epgId",
    "epg_id",
    "uid"
  ]));
}

function channelName(channel) {
  return text(first(channel, [
    "name",
    "channelName",
    "channel_name",
    "title",
    "displayName",
    "display_name"
  ]));
}

function programTitle(program) {
  return text(first(program, [
    "title",
    "name",
    "programName",
    "program_name",
    "eventName",
    "event_name",
    "originalTitle",
    "original_title"
  ]));
}

function programStart(program) {
  return first(program, [
    "start",
    "startTime",
    "start_time",
    "startDate",
    "start_date",
    "startDateTime",
    "start_date_time",
    "begin",
    "beginTime",
    "begin_time",
    "dateTime",
    "datetime",
    "airingStart",
    "airing_start"
  ]);
}

function programStop(program) {
  return first(program, [
    "stop",
    "end",
    "endTime",
    "end_time",
    "endDate",
    "end_date",
    "endDateTime",
    "end_date_time",
    "finish",
    "finishTime",
    "finish_time",
    "airingEnd",
    "airing_end"
  ]);
}

function programDescription(program) {
  return text(first(program, [
    "description",
    "summary",
    "synopsis",
    "shortDescription",
    "short_description",
    "detail"
  ]));
}

function parseDate(value, day) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
    const number = Number(value);
    const milliseconds =
      number < 10000000000 ? number * 1000 : number;
    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  let valueText = String(value).trim();

  if (!valueText) return null;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(valueText)) {
    valueText = `${day}T${valueText}`;
  }

  if (/^\d{4}-\d{2}-\d{2} \d/.test(valueText)) {
    valueText = valueText.replace(" ", "T");
  }

  const date = new Date(valueText);

  return Number.isNaN(date.getTime()) ? null : date;
}

function xmltvTime(date) {
  const pad = value => String(value).padStart(2, "0");

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

async function fetchJson(day, page) {
  const url = new URL(BASE_URL);

  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_LIMIT));
  url.searchParams.set("day", day);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT
    );

    try {
      console.log(
        `İstek: ${day} | Sayfa ${page} | Deneme ${attempt}/${MAX_RETRIES}`
      );

      const response = await fetch(url, {
        method: "GET",
        headers: HEADERS,
        signal: controller.signal
      });

      const body = await response.text();

      if (!response.ok) {
        console.error(`HTTP ${response.status}: ${url}`);
        console.error(
          `Sunucu yanıtı: ${body.replace(/\s+/g, " ").slice(0, 700)}`
        );

        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;

        if (
          response.status === 403 ||
          response.status === 401 ||
          response.status === 400 ||
          response.status === 404
        ) {
          throw error;
        }

        if (
          ![408, 425, 429, 500, 502, 503, 504].includes(response.status)
        ) {
          throw error;
        }

        if (attempt === MAX_RETRIES) throw error;

        await sleep(attempt * 2000);
        continue;
      }

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        throw new Error(
          `Sunucu JSON yerine farklı bir yanıt döndürdü: ${body.slice(0, 300)}`
        );
      }

      return data;
    } catch (error) {
      if (error.status) throw error;

      console.error(`İstek hatası: ${error.message}`);

      if (attempt === MAX_RETRIES) throw error;

      await sleep(attempt * 2000);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${day} sayfa ${page} alınamadı.`);
}

function extractChannels(data) {
  if (!data || typeof data !== "object") return [];

  const candidates = [
    data?.data?.channels,
    data?.channels,
    data?.data?.items,
    data?.items,
    data?.data?.results,
    data?.results,
    data?.data?.content,
    data?.content
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function pageCount(data, page, count) {
  const possible = [
    data?.data?.totalPages,
    data?.data?.total_pages,
    data?.data?.lastPage,
    data?.data?.last_page,
    data?.totalPages,
    data?.total_pages,
    data?.lastPage,
    data?.last_page
  ];

  for (const value of possible) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return Math.min(number, 1000);
    }
  }

  const totals = [
    data?.data?.total,
    data?.data?.totalCount,
    data?.data?.total_count,
    data?.total,
    data?.totalCount,
    data?.total_count
  ];

  for (const value of totals) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return Math.max(1, Math.ceil(number / PAGE_LIMIT));
    }
  }

  return count >= PAGE_LIMIT ? page + 1 : page;
}

async function fetchAllChannels(day) {
  const channels = new Map();
  let page = 1;
  let lastPage = 1;

  while (page <= lastPage) {
    const data = await fetchJson(day, page);
    const items = extractChannels(data);

    if (page === 1 && items.length === 0) {
      console.log(
        `UYARI: ${day} yanıtında tanınan kanal listesi bulunamadı.`
      );
      console.log(
        `Yanıt anahtarları: ${Object.keys(data || {}).join(", ")}`
      );

      if (data?.data && typeof data.data === "object") {
        console.log(
          `data anahtarları: ${Object.keys(data.data).join(", ")}`
        );
      }

      return [];
    }

    for (const item of items) {
      const id = channelId(item);
      const name = channelName(item);
      const key = id || name;

      if (key && !channels.has(key)) {
        channels.set(key, item);
      }
    }

    lastPage = pageCount(data, page, items.length);

    console.log(
      `${day}: sayfa ${page}/${lastPage}, ${items.length} kayıt`
    );

    if (page >= lastPage) break;

    page++;
    await sleep(REQUEST_DELAY);
  }

  return [...channels.values()];
}

function collectProgramObjects(value, output, visited = new Set()) {
  if (!value || typeof value !== "object") return;
  if (visited.has(value)) return;

  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectProgramObjects(item, output, visited);
    }
    return;
  }

  const title = programTitle(value);
  const start = programStart(value);

  if (title && start) {
    output.push(value);
  }

  for (const [key, child] of Object.entries(value)) {
    if (
      ["logo", "image", "images", "channelInfo", "channel_info"].includes(key)
    ) {
      continue;
    }

    if (child && typeof child === "object") {
      collectProgramObjects(child, output, visited);
    }
  }
}

function extractPrograms(channel, day) {
  const objects = [];
  collectProgramObjects(channel, objects);

  const unique = new Map();

  for (const item of objects) {
    const title = programTitle(item);
    const start = parseDate(programStart(item), day);
    let stop = parseDate(programStop(item), day);

    if (!title || !start) continue;
    if (stop && stop <= start) stop = null;

    const key = `${title}|${start.toISOString()}`;

    if (!unique.has(key)) {
      unique.set(key, {
        title,
        start,
        stop,
        description: programDescription(item)
      });
    }
  }

  const programs = [...unique.values()].sort(
    (a, b) => a.start - b.start
  );

  for (let i = 0; i < programs.length; i++) {
    if (!programs[i].stop) {
      const next = programs[i + 1];

      programs[i].stop =
        next && next.start > programs[i].start
          ? next.start
          : new Date(programs[i].start.getTime() + 30 * 60000);
    }
  }

  return programs.filter(item => item.stop > item.start);
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
    for (const program of channel.programs) {
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

  let successfulDays = 0;

  for (const day of days) {
    console.log("");
    console.log(`Tarih: ${day}`);

    let items;

    try {
      items = await fetchAllChannels(day);
      successfulDays++;
    } catch (error) {
      console.error(`${day} alınamadı: ${error.message}`);
      continue;
    }

    for (const item of items) {
      const id = channelId(item);
      const name = channelName(item);
      const key = id || name;

      if (!key) continue;

      if (!channelsMap.has(key)) {
        channelsMap.set(key, {
          id: key,
          name: name || key,
          programs: new Map()
        });
      }

      const channel = channelsMap.get(key);

      for (const program of extractPrograms(item, day)) {
        const programKey =
          `${program.title}|${program.start.toISOString()}`;

        if (!channel.programs.has(programKey)) {
          channel.programs.set(programKey, program);
        }
      }
    }

    await sleep(REQUEST_DELAY);
  }

  const channels = [...channelsMap.values()].map(channel => ({
    id: channel.id,
    name: channel.name,
    programs: [...channel.programs.values()].sort(
      (a, b) => a.start - b.start
    )
  }));

  const programTotal = channels.reduce(
    (total, channel) => total + channel.programs.length,
    0
  );

  console.log("");
  console.log(`Başarılı gün isteği: ${successfulDays}/${days.length}`);
  console.log(`Kanal sayısı: ${channels.length}`);
  console.log(`Program sayısı: ${programTotal}`);

  if (successfulDays === 0) {
    throw new Error(
      "Hiçbir gün için API verisi alınamadı. Mevcut XML korunuyor."
    );
  }

  if (programTotal === 0) {
    throw new Error(
      "Program bulunamadı. API yanıt şeması farklı olabilir. Mevcut XML korunuyor."
    );
  }

  const xml = buildXml(channels);

  if (!xml.includes("<programme ") || !xml.includes("</tv>")) {
    throw new Error("XML doğrulaması başarısız. Mevcut dosya korunuyor.");
  }

  fs.writeFileSync(TEMP_FILE, xml, "utf8");

  const written = fs.readFileSync(TEMP_FILE, "utf8");

  if (!written.includes("<programme ")) {
    fs.unlinkSync(TEMP_FILE);
    throw new Error("Geçici XML kontrolü başarısız.");
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
