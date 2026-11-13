
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
const REQUEST_DELAY_MS = 500;

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
  { id: "VISH", name: "Viasat History", cmsId: 246054 },
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

function turkeyToday() {
  const now = new Date();
  const turkeyTime = new Date(
    now.getTime() + 3 * 60 * 60 * 1000
  );

  return turkeyTime.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + days);

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

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ı]/g, "i")
    .replace(/[^a-z0-9]/g, "");
}

function getDatePart(value) {
  if (!value) return null;

  const match = String(value)
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : null;
}

function parseClock(dateValue, timeValue, fallbackDate) {
  if (timeValue === null || timeValue === undefined) {
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

  if (!clock) return null;

  const datePart =
    getDatePart(dateValue) || fallbackDate;

  if (!datePart) return null;

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

  // API sayısal duration değerini dakika olarak döndürebilir.
  if (
    typeof value === "number" ||
    /^\d+(?:\.\d+)?$/.test(String(value).trim())
  ) {
    const minutes = Number(value);

    return minutes > 0
      ? minutes * 60 * 1000
      : 0;
  }

  const match = String(value)
    .trim()
    .match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);

  if (!match) return 0;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (minutes > 59 || seconds > 59) return 0;

  return (
    hours * 3600 +
    minutes * 60 +
    seconds
  ) * 1000;
}

function getProgramStart(item) {
  return parseClock(
    item.date,
    item.startHour,
    getDatePart(item.date)
  );
}

function getProgramEnd(item, start) {
  let stop = parseClock(
    item.date,
    item.endHour,
    getDatePart(item.date)
  );

  // Gece yarısını geçen programlar.
  if (stop && stop <= start) {
    stop = new Date(
      stop.getTime() + 24 * 60 * 60 * 1000
    );
  }

  // Bitiş saati yoksa duration kullan.
  if (!stop || stop <= start) {
    const duration = parseDuration(item.duration);

    if (duration > 0) {
      stop = new Date(start.getTime() + duration);
    }
  }

  return stop && stop > start ? stop : null;
}

function isEmptyPlaceholder(item, channel) {
  const epgId = String(item.epgId ?? "").trim();
  const parentId = String(item.parentId ?? "").trim();
  const url = String(item.url ?? "").trim();

  const channelName = normalizeName(channel.name);
  const programName = normalizeName(item.name);
  const description = normalizeName(item.description);

  const nameMatches = programName === channelName;
  const descriptionMatches = description === channelName;

  return (
    epgId === "" &&
    parentId === "" &&
    url === "" &&
    (nameMatches || descriptionMatches)
  );
}

function xmltvTime(date) {
  const local = new Date(
    date.getTime() + 3 * 60 * 60 * 1000
  );

  const pad = value =>
    String(value).padStart(2, "0");

  return (
    `${local.getUTCFullYear()}` +
    `${pad(local.getUTCMonth() + 1)}` +
    `${pad(local.getUTCDate())}` +
    `${pad(local.getUTCHours())}` +
    `${pad(local.getUTCMinutes())}` +
    `${pad(local.getUTCSeconds())} +0300`
  );
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
    console.log("");
    console.log("--------------------------------------");
    console.log(`KANAL: ${channel.name}`);
    console.log(`CMS ID: ${channel.cmsId}`);
    console.log("--------------------------------------");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "DSmart-EPG-Updater/2.1"
      },
      signal: controller.signal
    });

    const body = await response.text();

    console.log(`HTTP: ${response.status}`);

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
      throw new Error(
        `${channel.name}: API geçerli JSON döndürmedi.`
      );
    }

    if (!Array.isArray(payload)) {
      throw new Error(
        `${channel.name}: API yanıtı JSON dizisi değil.`
      );
    }

    if (payload.length === 0) {
      throw new Error(
        `${channel.name}: API boş liste döndürdü.`
      );
    }

    const statusCounts = {};

    for (const item of payload) {
      const status = String(item.statusCode ?? "BOS");

      statusCounts[status] =
        (statusCounts[status] || 0) + 1;
    }

    console.log(`API kayıt sayısı: ${payload.length}`);
    console.log(
      "Durum kodları:",
      JSON.stringify(statusCounts)
    );

    const programs = [];
    let skipped300 = 0;
    let invalidProgramCount = 0;

    for (const item of payload) {
      const status = Number(item.statusCode);

      if (status === 300) {
        if (
          String(item.cmsId) !== String(channel.cmsId)
        ) {
          console.log(
            "CMS ID uyuşmazlığı:",
            JSON.stringify(item)
          );

          throw new Error(
            `${channel.name}: 300 kaydında CMS ID uyuşmazlığı.`
          );
        }

        if (!isEmptyPlaceholder(item, channel)) {
          console.log(
            "Şüpheli 300 kaydı:",
            JSON.stringify(item)
          );

          throw new Error(
            `${channel.name}: Boş kayıt olmayan 300 durum kodu bulundu.`
          );
        }

        skipped300++;
        continue;
      }

      if (status !== 200) {
        console.log(
          "Beklenmeyen kayıt:",
          JSON.stringify(item)
        );

        throw new Error(
          `${channel.name}: Beklenmeyen statusCode=${item.statusCode}.`
        );
      }

      if (
        String(item.cmsId) !== String(channel.cmsId)
      ) {
        console.log(
          "CMS ID uyuşmazlığı:",
          JSON.stringify(item)
        );

        throw new Error(
          `${channel.name}: Program kaydında CMS ID uyuşmazlığı.`
        );
      }

      const title = String(item.name ?? "").trim();

      if (!title) {
        invalidProgramCount++;
        continue;
      }

      const start = getProgramStart(item);

      if (!start) {
        invalidProgramCount++;
        continue;
      }

      const stop = getProgramEnd(item, start);

      if (!stop) {
        invalidProgramCount++;
        continue;
      }

      programs.push({
        title,
        description: String(item.description ?? "").trim(),
        start,
        stop
      });
    }

    console.log(
      `300 boş kayıt atlandı: ${skipped300}`
    );

    console.log(
      `Geçersiz program kaydı: ${invalidProgramCount}`
    );

    if (programs.length === 0) {
      throw new Error(
        `${channel.name}: Geçerli 200 program kaydı bulunamadı.`
      );
    }

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
      `${channel.name}: ${finalPrograms.length} gerçek program alındı.`
    );

    return {
      ...channel,
      programs: finalPrograms,
      skipped300,
      invalidProgramCount
    };
  } finally {
    clearTimeout(timeout);
  }
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
    !xml.includes('<?xml version="1.0"') ||
    !xml.includes("<tv") ||
    !xml.includes("</tv>")
  ) {
    throw new Error("XMLTV dosya yapısı geçersiz.");
  }

  const programmeCount =
    (xml.match(/<programme\s/g) || []).length;

  if (programmeCount === 0) {
    throw new Error("XML içinde program bulunamadı.");
  }

  for (const channel of channels) {
    const expected =
      `<channel id="${channel.id}">`;

    if (!xml.includes(expected)) {
      throw new Error(
        `${channel.name}: XML kanal kaydı eksik.`
      );
    }
  }

  return programmeCount;
}

async function main() {
  console.log("======================================");
  console.log("D-SMART 23 KANAL EPG");
  console.log("======================================");

  if (!API_KEY) {
    throw new Error(
      "DS_MART_API_KEY GitHub Secret bulunamadı."
    );
  }

  const startDate = turkeyToday();
  const endDate = addDays(
    startDate,
    DAYS_TO_FETCH - 1
  );

  console.log(`Kanal sayısı: ${CHANNELS.length}`);
  console.log(`Başlangıç: ${startDate}`);
  console.log(`Bitiş: ${endDate}`);
  console.log("Viasat History CMS ID: 246054");

  const results = [];

  for (const channel of CHANNELS) {
    const result = await fetchChannel(
      channel,
      startDate,
      endDate
    );

    results.push(result);

    await sleep(REQUEST_DELAY_MS);
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
    throw new Error(
      "Geçici XML doğrulaması başarısız."
    );
  }

  // Önceki XML yalnızca bütün kontroller başarılıysa değiştirilir.
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

  console.log("--------------------------------------");
  console.log(`Toplam kanal: ${results.length}`);
  console.log(`Toplam program: ${programmeCount}`);
  console.log(`Dosya: ${OUTPUT_FILE}`);
  console.log(
    `Dosya boyutu: ${fs.statSync(OUTPUT_FILE).size} bayt`
  );
}

main().catch(error => {
  console.error("");
  console.error("D-SMART EPG HATASI:");
  console.error(error.message);

  if (fs.existsSync(TEMP_FILE)) {
    try {
      fs.unlinkSync(TEMP_FILE);
    } catch (cleanupError) {
      console.error(
        "Geçici dosya silinemedi:",
        cleanupError.message
      );
    }
  }

  console.error("Mevcut dsmart.xml korunuyor.");

  process.exitCode = 1;
});
