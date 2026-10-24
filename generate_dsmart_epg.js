
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml");
const TEMP_FILE = path.join(__dirname, "dsmart.xml.tmp");

const API_URL =
  "https://global-epg-prod.erstream.com/Epg/GetChannelEpgWithRange";

const API_KEY = "pln1jFxpWu1AMwtH1PIU";

const TIMEZONE = "03";
const LANGUAGE = "tr";
const DAYS_TO_FETCH = 6;
const TIMEOUT_MS = 60000;

const CHANNELS = [
  {
    id: "MSCL",
    name: "Movie Smart Classic",
    cmsId: 246150
  },
  {
    id: "MSTU",
    name: "Movie Smart Türk",
    cmsId: 246147
  },
  {
    id: "SPPR",
    name: "Sport Smart",
    cmsId: 246003
  },
  {
    id: "SPS2",
    name: "Sport Smart 2",
    cmsId: 246171
  }
];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function istanbulToday() {
  const now = new Date();
  const utcMs = now.getTime();
  const turkeyMs = utcMs + 3 * 60 * 60 * 1000;

  return new Date(turkeyMs).toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);

  return date.toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function firstValue(object, keys) {
  if (!object || typeof object !== "object") {
    return null;
  }

  for (const key of keys) {
    const value = object[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function textValue(value) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "object"
  ) {
    return "";
  }

  return String(value).trim();
}

function getTitle(program) {
  return textValue(firstValue(program, [
    "name",
    "programName",
    "program_name",
    "title",
    "eventName",
    "contentName"
  ]));
}

function getDescription(program) {
  return textValue(firstValue(program, [
    "description",
    "summary",
    "synopsis",
    "shortDescription"
  ]));
}

function getDatePart(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const input = String(value).trim();

  const iso = input.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    return iso[1];
  }

  const european = input.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})/
  );

  if (european) {
    return (
      european[3] + "-" +
      european[2].padStart(2, "0") + "-" +
      european[1].padStart(2, "0")
    );
  }

  return null;
}

function parseDateTime(dateValue, timeValue, fallbackDate) {
  if (
    timeValue === null ||
    timeValue === undefined ||
    timeValue === ""
  ) {
    return null;
  }

  if (typeof timeValue === "number") {
    const milliseconds =
      timeValue < 10000000000
        ? timeValue * 1000
        : timeValue;

    const result = new Date(milliseconds);

    return Number.isNaN(result.getTime())
      ? null
      : result;
  }

  const input = String(timeValue).trim();

  if (/^\d{10,13}$/.test(input)) {
    const number = Number(input);
    const milliseconds =
      number < 10000000000
        ? number * 1000
        : number;

    const result = new Date(milliseconds);

    return Number.isNaN(result.getTime())
      ? null
      : result;
  }

  // Başlangıç veya bitiş tam tarih-saat olarak geldiyse.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(input)) {
    let normalized = input.replace(" ", "T");

    // Saat dilimi belirtilmemişse API'nin +03 saatini uygula.
    if (!/(Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i.test(normalized)) {
      normalized += "+03:00";
    }

    const result = new Date(normalized);

    return Number.isNaN(result.getTime())
      ? null
      : result;
  }

  // Saat yalnızca HH:mm veya HH:mm:ss biçimindeyse.
  const clock = input.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (clock) {
    const datePart =
      getDatePart(dateValue) || fallbackDate;

    if (!datePart) {
      return null;
    }

    const hour = clock[1].padStart(2, "0");
    const minute = clock[2];
    const second = clock[3] || "00";

    const result = new Date(
      `${datePart}T${hour}:${minute}:${second}+03:00`
    );

    return Number.isNaN(result.getTime())
      ? null
      : result;
  }

  // Diğer geçerli tarih biçimlerini dene.
  const result = new Date(input);

  return Number.isNaN(result.getTime())
    ? null
    : result;
}

function parseDuration(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    // Sayısal süreler API'de saniye olarak gelirse.
    return value > 0 ? value * 1000 : 0;
  }

  const input = String(value).trim();

  const match = input.match(
    /(?:^|,\s*)(\d{1,3}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return 0;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3] || 0);

  if (second > 59 || third > 59) {
    return 0;
  }

  return (first * 3600 + second * 60 + third) * 1000;
}

function getProgramStart(program, day) {
  const dateValue = firstValue(program, [
    "date",
    "broadcastDate",
    "day",
    "startDate"
  ]);

  const timeValue = firstValue(program, [
    "startHour",
    "startTime",
    "start_date",
    "startDateTime",
    "start",
    "begin"
  ]);

  return parseDateTime(dateValue, timeValue, day);
}

function getProgramEnd(program, day, start) {
  const dateValue = firstValue(program, [
    "endDate",
    "broadcastDate",
    "date",
    "day"
  ]);

  const timeValue = firstValue(program, [
    "endHour",
    "endTime",
    "end_date",
    "endDateTime",
    "stop",
    "end"
  ]);

  let stop = parseDateTime(dateValue, timeValue, day);

  // Program gece yarısını aşıyorsa bitişi ertesi güne taşı.
  if (stop && stop <= start) {
    const endInput = String(timeValue ?? "").trim();

    // Tam tarih-saat verilmişse tarih yanlışlığını gizleme.
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(endInput)) {
      return null;
    }

    stop = new Date(stop.getTime() + 24 * 60 * 60 * 1000);
  }

  if (!stop || stop <= start) {
    const duration = parseDuration(
      firstValue(program, [
        "duration",
        "length",
        "runtime"
      ])
    );

    if (duration > 0) {
      stop = new Date(start.getTime() + duration);
    }
  }

  return stop && stop > start ? stop : null;
}

function findPrograms(payload) {
  const result = [];
  const visited = new Set();

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    if (visited.has(value)) {
      return;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    const title = getTitle(value);

    const startValue = firstValue(value, [
      "startHour",
      "startTime",
      "start_date",
      "startDateTime",
      "start",
      "begin"
    ]);

    const endValue = firstValue(value, [
      "endHour",
      "endTime",
      "end_date",
      "endDateTime",
      "stop",
      "end",
      "duration",
      "length",
      "runtime"
    ]);

    if (title && startValue !== null && endValue !== null) {
      result.push(value);
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") {
        walk(child);
      }
    }
  }

  walk(payload);

  return result;
}

async function fetchChannel(channel, startDate, endDate) {
  const url = new URL(API_URL);

  url.searchParams.set("includeEnding", "true");
  url.searchParams.set("fillResponse", "true");
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("cmsId", String(channel.cmsId));
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("timezone", TIMEZONE);
  url.searchParams.set("lang", LANGUAGE);

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  try {
    console.log(`GET ${channel.name}: ${startDate} - ${endDate}`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "DSmart-EPG-Updater/1.0"
      },
      signal: controller.signal
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(
        `${channel.name}: HTTP ${response.status} — ` +
        body.replace(/\s+/g, " ").slice(0, 250)
      );
    }

    let payload;

    try {
      payload = JSON.parse(body);
    } catch {
      throw new Error(
        `${channel.name}: API geçerli JSON döndürmedi.`
      );
    }

    if (
      payload &&
      payload.statusCode !== undefined &&
      Number(payload.statusCode) !== 200
    ) {
      throw new Error(
        `${channel.name}: API statusCode=${payload.statusCode}`
      );
    }

    const rawPrograms = findPrograms(payload);
    const programs = [];

    for (const item of rawPrograms) {
      const title = getTitle(item);
      if (!title) continue;

      const dateValue = firstValue(item, [
        "date",
        "broadcastDate",
        "day",
        "startDate"
      ]);

      const day =
        getDatePart(dateValue) || startDate;

      const start = getProgramStart(item, day);
      if (!start) continue;

      const stop = getProgramEnd(item, day, start);
      if (!stop) continue;

      programs.push({
        title,
        description: getDescription(item),
        start,
        stop
      });
    }

    // Aynı program iki kez geldiyse tek kayıt tut.
    const unique = new Map();

    for (const program of programs) {
      const key =
        `${program.title}|${program.start.getTime()}`;

      if (!unique.has(key)) {
        unique.set(key, program);
      }
    }

    const finalPrograms = [...unique.values()].sort(
      (a, b) => a.start - b.start
    );

    console.log(
      `${channel.name}: ${finalPrograms.length} program alındı.`
    );

    if (finalPrograms.length === 0) {
      throw new Error(
        `${channel.name}: API yanıtından program çıkarılamadı.`
      );
    }

    return {
      ...channel,
      programs: finalPrograms
    };
  } finally {
    clearTimeout(timeout);
  }
}

function xmltvTime(date) {
  // Tarih nesnesi gerçek anı tutar; XMLTV'de +0300 gösterilir.
  const local = new Date(date.getTime() + 3 * 60 * 60 * 1000);

  const pad = number =>
    String(number).padStart(2, "0");

  return (
    `${local.getUTCFullYear()}` +
    `${pad(local.getUTCMonth() + 1)}` +
    `${pad(local.getUTCDate())}` +
    `${pad(local.getUTCHours())}` +
    `${pad(local.getUTCMinutes())}` +
    `${pad(local.getUTCSeconds())} +0300`
  );
}

function buildXml(channels) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="D-Smart Four Channel EPG">'
  ];

  for (const channel of channels) {
    lines.push(
      `  <channel id="${escapeXml(channel.id)}">`,
      `    <display-name lang="tr">${escapeXml(channel.name)}</display-name>`,
      "  </channel>"
    );
  }

  for (const channel of channels) {
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

function validateXml(xml, channels) {
  if (
    !xml.includes('<?xml') ||
    !xml.includes("<tv") ||
    !xml.includes("</tv>")
  ) {
    throw new Error("XMLTV yapısı geçersiz.");
  }

  const programmeCount =
    (xml.match(/<programme\s/g) || []).length;

  if (programmeCount === 0) {
    throw new Error("XML içinde program bulunamadı.");
  }

  for (const channel of channels) {
    if (!xml.includes(`channel="${channel.id}"`)) {
      throw new Error(
        `${channel.name}: XML içinde kanal/program kaydı bulunamadı.`
      );
    }
  }

  return programmeCount;
}

async function main() {
  console.log("======================================");
  console.log("D-SMART 4 KANAL EPG BAŞLADI");
  console.log("======================================");

  const startDate = istanbulToday();
  const endDate = addDays(startDate, DAYS_TO_FETCH - 1);

  console.log(`Başlangıç: ${startDate}`);
  console.log(`Bitiş: ${endDate}`);
  console.log("");

  const results = [];

  // Her kanal ayrı sorgulanır.
  for (const channel of CHANNELS) {
    const result = await fetchChannel(
      channel,
      startDate,
      endDate
    );

    results.push(result);

    await sleep(500);
  }

  // Dört kanalın tamamı başarılı olmadan eski dosyayı değiştirme.
  if (results.length !== CHANNELS.length) {
    throw new Error(
      "Dört kanalın tamamı alınamadı. Mevcut XML korunuyor."
    );
  }

  const xml = buildXml(results);
  const programmeCount = validateXml(xml, results);

  fs.writeFileSync(TEMP_FILE, xml, "utf8");

  const savedXml = fs.readFileSync(TEMP_FILE, "utf8");
  const savedCount = validateXml(savedXml, results);

  if (savedCount !== programmeCount) {
    fs.unlinkSync(TEMP_FILE);

    throw new Error(
      "Geçici XML doğrulaması başarısız. Mevcut XML korunuyor."
    );
  }

  // Doğrulama başarılıysa dsmart.xml dosyasını güncelle.
  fs.renameSync(TEMP_FILE, OUTPUT_FILE);

  console.log("");
  console.log("======================================");
  console.log("EPG BAŞARIYLA OLUŞTURULDU");
  console.log("======================================");

  for (const channel of results) {
    console.log(
      `${channel.name}: ${channel.programs.length} program`
    );
  }

  console.log(`Toplam program: ${programmeCount}`);
  console.log(`Dosya: ${OUTPUT_FILE}`);
  console.log(`Boyut: ${fs.statSync(OUTPUT_FILE).size} bayt`);
}

main().catch(error => {
  console.error("");
  console.error("D-SMART EPG HATASI:");
  console.error(error.message);

  if (fs.existsSync(TEMP_FILE)) {
    try {
      fs.unlinkSync(TEMP_FILE);
    } catch {}
  }

  console.error("Mevcut dsmart.xml korunuyor.");
  process.exitCode = 1;
});
