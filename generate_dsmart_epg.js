
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml");
const TEMP_FILE = path.join(__dirname, "dsmart.xml.tmp");

const API_URL =
  "https://global-epg-prod.erstream.com/Epg/GetChannelEpgWithRange";

const API_KEY = process.env.DS_MART_API_KEY;

const TIMEZONE = "03";
const LANGUAGE = "tr";
const DAYS_TO_FETCH = 7;
const TIMEOUT_MS = 60000;

const CHANNELS = [
  { id: "MSCL", name: "Movie Smart Classic", cmsId: 246150 },
  { id: "MSTU", name: "Movie Smart Türk", cmsId: 246147 },
  { id: "SPPR", name: "Sport Smart", cmsId: 246003 },
  { id: "SPS2", name: "Sport Smart 2", cmsId: 246171 },
  { id: "CSMR", name: "Çocuk Smart", cmsId: 246012 },
  { id: "DSMX", name: "Dizi Smart Max", cmsId: 246015 },
  { id: "NATG", name: "National Geographic", cmsId: 246180 },
  { id: "NGWD", name: "National Geographic WILD", cmsId: 246183 },
  { id: "COSM", name: "Cosmo En", cmsId: 1301767 },
  { id: "VISH", name: "Viasat History", cmsId: 146054 },
  { id: "DOCS", name: "Docu Screen", cmsId: 245976 },
  { id: "LOVE", name: "Love Nature", cmsId: 246189 },
  { id: "DISC", name: "Discovery Channel", cmsId: 245964 },
  { id: "IDIS", name: "Discovery ID", cmsId: 245955 },
  { id: "FASH", name: "Fashion TV", cmsId: 245982 },
  { id: "SZCT", name: "SZC TV", cmsId: 246240 },
  { id: "SHMX", name: "Show Max", cmsId: 246165 },
  { id: "DRTV", name: "Dream TV", cmsId: 246093 },
  { id: "BABY", name: "Baby TV", cmsId: 245952 },
  { id: "AZOO", name: "Azoomee", cmsId: 246168 },
  { id: "BBCF", name: "BBC FIRST", cmsId: 1314412 },
  { id: "KAND", name: "Kanal D", cmsId: 245931 },
  { id: "FX", name: "FX", cmsId: 246186 }
];

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function istanbulToday() {
  const now = new Date();
  const turkeyMs = now.getTime() + 3 * 60 * 60 * 1000;

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

function getDatePart(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : null;
}

function parseClock(dateValue, timeValue, fallbackDate) {
  if (
    timeValue === null ||
    timeValue === undefined ||
    timeValue === ""
  ) {
    return null;
  }

  const input = String(timeValue).trim();

  const fullDate = input.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2}(?::\d{2})?)/
  );

  if (fullDate) {
    const normalized = input.replace(" ", "T");

    const withTimezone =
      /(?:Z|[+-]\d{2}:\d{2}|[+-]\d{4})$/i.test(normalized)
        ? normalized
        : `${normalized}+03:00`;

    const result = new Date(withTimezone);

    return Number.isNaN(result.getTime()) ? null : result;
  }

  const clock = input.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!clock) {
    return null;
  }

  const datePart = getDatePart(dateValue) || fallbackDate;

  if (!datePart) {
    return null;
  }

  const hour = clock[1].padStart(2, "0");
  const minute = clock[2];
  const second = clock[3] || "00";

  const result = new Date(
    `${datePart}T${hour}:${minute}:${second}+03:00`
  );

  return Number.isNaN(result.getTime()) ? null : result;
}

function parseDuration(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const match = String(value).trim().match(
    /(?:^|,\s*)(\d{1,3}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (minutes > 59 || seconds > 59) {
    return 0;
  }

  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

function getProgramStart(program) {
  return parseClock(
    program.date,
    program.startHour,
    getDatePart(program.date)
  );
}

function getProgramEnd(program, start) {
  let stop = parseClock(
    program.date,
    program.endHour,
    getDatePart(program.date)
  );

  if (stop && stop <= start) {
    stop = new Date(stop.getTime() + 24 * 60 * 60 * 1000);
  }

  if (!stop || stop <= start) {
    const duration = parseDuration(program.duration);

    if (duration > 0) {
      stop = new Date(start.getTime() + duration);
    }
  }

  return stop && stop > start ? stop : null;
}

function getTitle(program) {
  return String(program.name ?? "").trim();
}

function getDescription(program) {
  return String(program.description ?? "").trim();
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
        Accept: "application/json",
        "User-Agent": "DSmart-EPG-Updater/2.0"
      },
      signal: controller.signal
    });

    const body = await response.text();

    console.log(
      `${channel.name}: HTTP yanıtı ${response.status}`
    );

    if (!response.ok) {
      throw new Error(
        `${channel.name}: HTTP ${response.status} — ` +
        body.replace(/\s+/g, " ").slice(0, 500)
      );
    }

    let payload;

    try {
      payload = JSON.parse(body);
    } catch {
      console.log(
        "JSON olmayan API yanıtı:",
        body.slice(0, 1000)
      );

      throw new Error(
        `${channel.name}: API geçerli JSON döndürmedi.`
      );
    }

    if (!Array.isArray(payload)) {
      console.log(
        "Beklenmeyen API yanıtı:",
        JSON.stringify(payload, null, 2).slice(0, 3000)
      );

      throw new Error(
        `${channel.name}: API yanıtı beklenen JSON dizisi değil.`
      );
    }

    console.log(
      `${channel.name}: API toplam ${payload.length} kayıt döndürdü.`
    );

    if (payload.length === 0) {
      throw new Error(
        `${channel.name}: API boş program listesi döndürdü.`
      );
    }

    const statusCounts = {};

    for (const item of payload) {
      const status = String(item.statusCode ?? "BOS");
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    console.log(
      `${channel.name}: API durum kodları:`,
      JSON.stringify(statusCounts)
    );

    const invalidRecords = payload.filter(
      item => Number(item.statusCode) !== 200
    );

    if (invalidRecords.length > 0) {
      console.log(
        `${channel.name}: Başarısız kayıt sayısı: ${invalidRecords.length}`
      );

      console.log(
        `${channel.name}: İlk başarısız API kayıtları:`
      );

      for (const item of invalidRecords.slice(0, 5)) {
        console.log(JSON.stringify(item, null, 2));
      }

      throw new Error(
        `${channel.name}: API statusCode=${invalidRecords[0].statusCode}. ` +
        `${invalidRecords.length} başarısız kayıt bulundu.`
      );
    }

    const programs = [];

    for (const item of payload) {
      if (String(item.cmsId) !== String(channel.cmsId)) {
        console.log(
          "CMS ID uyuşmazlığı:",
          JSON.stringify(item)
        );

        throw new Error(
          `${channel.name}: Yanıtta farklı CMS ID bulundu.`
        );
      }

      const title = getTitle(item);

      if (!title) continue;

      const start = getProgramStart(item);

      if (!start) continue;

      const stop = getProgramEnd(item, start);

      if (!stop) continue;

      programs.push({
        title,
        description: getDescription(item),
        start,
        stop
      });
    }

    const unique = new Map();

    for (const program of programs) {
      const key = `${program.title}|${program.start.getTime()}`;

      if (!unique.has(key)) {
        unique.set(key, program);
      }
    }

    const finalPrograms = [...unique.values()].sort(
      (a, b) => a.start - b.start
    );

    if (finalPrograms.length === 0) {
      throw new Error(
        `${channel.name}: Geçerli program kaydı çıkarılamadı.`
      );
    }

    console.log(
      `${channel.name}: ${finalPrograms.length} program alındı.`
    );

    return {
      ...channel,
      programs: finalPrograms
    };
  } finally {
    clearTimeout(timeout);
  }
}

function xmltvTime(date) {
  const local = new Date(
    date.getTime() + 3 * 60 * 60 * 1000
  );

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
    '<tv generator-info-name="D-Smart 23 Channel EPG">'
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
    if (!xml.includes(`<channel id="${channel.id}">`)) {
      throw new Error(
        `${channel.name}: XML içinde kanal kaydı bulunamadı.`
      );
    }
  }

  return programmeCount;
}

async function main() {
  console.log("======================================");
  console.log("D-SMART 23 KANAL EPG BAŞLADI");
  console.log("======================================");

  if (!API_KEY) {
    throw new Error(
      "DS_MART_API_KEY bulunamadı. GitHub Secrets ayarını kontrol edin."
    );
  }

  const startDate = istanbulToday();
  const endDate = addDays(startDate, DAYS_TO_FETCH - 1);

  console.log(`Kanal sayısı: ${CHANNELS.length}`);
  console.log(`Başlangıç: ${startDate}`);
  console.log(`Bitiş: ${endDate}`);
  console.log("");

  const results = [];

  for (const channel of CHANNELS) {
    const result = await fetchChannel(
      channel,
      startDate,
      endDate
    );

    results.push(result);

    await sleep(500);
  }

  if (results.length !== CHANNELS.length) {
    throw new Error(
      "23 kanalın tamamı alınamadı. Mevcut XML korunuyor."
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

  console.log(`Toplam kanal: ${results.length}`);
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
