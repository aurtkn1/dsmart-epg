
const fs = require("fs");
const path = require("path");

const API_URL =
  "https://global-epg-prod.erstream.com/Epg/GetChannelEpgWithRange";

const API_KEY = process.env.DS_MART_API_KEY;

const OUTPUT_FILE = path.join(__dirname, "dsmart.xml");
const TEMP_FILE = path.join(__dirname, "dsmart.xml.tmp");

const TIMEZONE = "03";
const LANGUAGE = "tr";
const DAYS_TO_FETCH = 7;
const TIMEOUT_MS = 60000;
const REQUEST_DELAY_MS = 500;

const CHANNELS = [
  { id: "MSCL", name: "Movie Smart Classic", cmsId: 246150 },
  { id: "MSTK", name: "Movie Smart Türk", cmsId: 246147 },
  {
    id: "SPPR",
    name: "Sport Smart",
    cmsId: 246003,
    apiNames: ["Spor Smart"]
  },
  {
    id: "SPS2",
    name: "Sport Smart 2",
    cmsId: 246171,
    apiNames: ["Spor Smart 2"]
  },
  { id: "COCUK", name: "Çocuk Smart", cmsId: 246012 },
  { id: "DSMAX", name: "Dizi Smart Max", cmsId: 246015 },
  { id: "NGEO", name: "National Geographic", cmsId: 246180 },
  { id: "NGWILD", name: "National Geographic WILD", cmsId: 246183 },
  { id: "COSMO", name: "Cosmo En", cmsId: 1301767 },
  { id: "VISH", name: "Viasat History", cmsId: 246054 },
  { id: "DOCU", name: "Docu Screen", cmsId: 245976 },
  { id: "LOVE", name: "Love Nature", cmsId: 246189 },
  { id: "DISC", name: "Discovery Channel", cmsId: 245964 },
  { id: "ID", name: "Discovery ID", cmsId: 245955 },
  { id: "FTV", name: "Fashion TV", cmsId: 245982 },
  { id: "SZC", name: "SZC TV", cmsId: 246240 },
  { id: "SHOWMAX", name: "Show Max", cmsId: 246165 },
  { id: "DREAM", name: "Dream TV", cmsId: 246093 },
  { id: "BABY", name: "Baby TV", cmsId: 245952 },
  { id: "AZOOMEE", name: "Azoomee", cmsId: 246168 },
  {
    id: "BBCFIRST",
    name: "BBC FIRST",
    cmsId: 1314412,
    apiNames: ["BBC First"]
  },
  { id: "KANALD", name: "Kanal D", cmsId: 245931 },
  { id: "FX", name: "FX", cmsId: 246186 }
];

function turkeyToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
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
    .replace(/\s+/g, "");
}

function getDatePart(value) {
  if (!value) return null;

  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);

  return match ? match[1] : null;
}

function parseClock(value) {
  if (!value) return null;

  const match = String(value).trim().match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);

  if (
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }

  return { hours, minutes, seconds };
}

function parseDuration(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? value * 60 * 1000
      : null;
  }

  const text = String(value).trim();

  if (/^\d+(\.\d+)?$/.test(text)) {
    const minutes = Number(text);
    return minutes > 0 ? minutes * 60 * 1000 : null;
  }

  const clock = parseClock(text);

  if (clock) {
    const milliseconds =
      ((clock.hours * 60 + clock.minutes) * 60 + clock.seconds) * 1000;

    return milliseconds > 0 ? milliseconds : null;
  }

  return null;
}

function makeDate(dateString, clockString) {
  const datePart = getDatePart(dateString);
  const clock = parseClock(clockString);

  if (!datePart || !clock) return null;

  const [year, month, day] = datePart.split("-").map(Number);

  return new Date(Date.UTC(
    year,
    month - 1,
    day,
    clock.hours,
    clock.minutes,
    clock.seconds
  ));
}

function getProgramStart(program) {
  return makeDate(program.date, program.startHour);
}

function getProgramEnd(program, start) {
  let end = makeDate(program.date, program.endHour);

  if (!end) {
    const duration = parseDuration(program.duration);

    if (!duration) return null;

    end = new Date(start.getTime() + duration);
  }

  if (end.getTime() <= start.getTime()) {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return end;
}

function getAcceptedChannelNames(channel) {
  return [
    channel.name,
    ...(channel.apiNames || [])
  ].map(normalizeName);
}

function isEmptyPlaceholder(program, channel) {
  const epgId = String(program.epgId ?? "").trim();
  const parentId = String(program.parentId ?? "").trim();
  const url = String(program.url ?? "").trim();

  const acceptedNames = getAcceptedChannelNames(channel);

  const nameMatches = acceptedNames.includes(
    normalizeName(program.name)
  );

  const descriptionMatches = acceptedNames.includes(
    normalizeName(program.description)
  );

  return (
    epgId === "" &&
    parentId === "" &&
    url === "" &&
    (nameMatches || descriptionMatches)
  );
}

function xmltvTime(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds} +0300`;
}

async function fetchChannel(channel, startDate, endDate) {
  console.log("--------------------------------------");
  console.log(`KANAL: ${channel.name}`);
  console.log(`CMS ID: ${channel.cmsId}`);
  console.log("--------------------------------------");

  const params = new URLSearchParams({
    includeEnding: "true",
    fillResponse: "true",
    key: API_KEY,
    cmsId: String(channel.cmsId),
    startDate,
    endDate,
    timezone: TIMEZONE,
    lang: LANGUAGE
  });

  const url = `${API_URL}?${params.toString()}`;

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUT_MS
  );

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  console.log(`HTTP: ${response.status}`);

  if (!response.ok) {
    throw new Error(
      `${channel.name}: API HTTP hatası ${response.status}`
    );
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error(
      `${channel.name}: API yanıtı beklenen dizi formatında değil.`
    );
  }

  const statusCounts = {};

  for (const item of data) {
    const status = String(item.statusCode);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  console.log(`API kayıt sayısı: ${data.length}`);
  console.log(`Durum kodları: ${JSON.stringify(statusCounts)}`);

  const programs = [];

  let skipped300 = 0;
  let invalidPrograms = 0;

  for (const item of data) {
    if (String(item.cmsId) !== String(channel.cmsId)) {
      throw new Error(
        `${channel.name}: CMS ID uyuşmazlığı. Gelen: ${item.cmsId}`
      );
    }

    const status = Number(item.statusCode);

    if (status === 300) {
      if (isEmptyPlaceholder(item, channel)) {
        skipped300++;
        continue;
      }

      console.log(
        `Şüpheli 300 kaydı: ${JSON.stringify(item)}`
      );

      throw new Error(
        `${channel.name}: Boş kayıt olmayan 300 durum kodu bulundu.`
      );
    }

    if (status !== 200) {
      console.log(
        `Beklenmeyen kayıt: ${JSON.stringify(item)}`
      );

      throw new Error(
        `${channel.name}: Beklenmeyen statusCode: ${status}`
      );
    }

    const title = String(item.name ?? "").trim();
    const start = getProgramStart(item);

    if (!title || !start) {
      invalidPrograms++;
      continue;
    }

    const end = getProgramEnd(item, start);

    if (!end || end.getTime() <= start.getTime()) {
      invalidPrograms++;
      continue;
    }

    programs.push({
      title,
      description: String(item.description ?? "").trim(),
      start,
      end
    });
  }

  console.log(`300 boş kayıt atlandı: ${skipped300}`);
  console.log(`Geçersiz program kaydı: ${invalidPrograms}`);

  if (programs.length === 0) {
    throw new Error(
      `${channel.name}: Hiç gerçek program alınamadı.`
    );
  }

  programs.sort((a, b) => a.start - b.start);

  console.log(
    `${channel.name}: ${programs.length} gerçek program alındı.`
  );

  return {
    ...channel,
    programs
  };
}

function buildXml(channelResults) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tv generator-info-name="D-Smart 23 Kanal EPG">'
  ];

  for (const channel of channelResults) {
    lines.push(
      `  <channel id="${escapeXml(channel.id)}">`,
      `    <display-name>${escapeXml(channel.name)}</display-name>`,
      "  </channel>"
    );
  }

  let totalPrograms = 0;

  for (const channel of channelResults) {
    for (const program of channel.programs) {
      totalPrograms++;

      lines.push(
        `  <programme start="${xmltvTime(program.start)}" stop="${xmltvTime(program.end)}" channel="${escapeXml(channel.id)}">`,
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

  lines.push("</tv>");

  return {
    xml: lines.join("\n") + "\n",
    totalPrograms
  };
}

function validateXml(xml, expectedChannels, expectedPrograms) {
  if (!xml.startsWith('<?xml version="1.0"')) {
    throw new Error("XML başlığı geçersiz.");
  }

  if (!xml.includes("<tv ") || !xml.includes("</tv>")) {
    throw new Error("XML ana tv etiketi eksik.");
  }

  const channelCount = (xml.match(/<channel id=/g) || []).length;
  const programCount = (xml.match(/<programme /g) || []).length;

  if (channelCount !== expectedChannels) {
    throw new Error(
      `XML kanal sayısı hatalı. Beklenen: ${expectedChannels}, bulunan: ${channelCount}`
    );
  }

  if (programCount !== expectedPrograms || programCount === 0) {
    throw new Error(
      `XML program sayısı hatalı. Beklenen: ${expectedPrograms}, bulunan: ${programCount}`
    );
  }

  if (xml.includes("undefined") || xml.includes("NaN")) {
    throw new Error("XML içinde geçersiz değer bulundu.");
  }

  console.log("--------------------------------------");
  console.log("EPG doğrulaması başarılı.");
  console.log(`Kanal sayısı: ${channelCount}`);
  console.log(`Program sayısı: ${programCount}`);
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function main() {
  console.log("======================================");
  console.log("D-SMART 23 KANAL EPG");
  console.log("======================================");

  if (!API_KEY) {
    throw new Error("DS_MART_API_KEY GitHub Secret bulunamadı.");
  }

  const startDate = turkeyToday();
  const endDate = addDays(startDate, DAYS_TO_FETCH - 1);

  console.log(`Kanal sayısı: ${CHANNELS.length}`);
  console.log(`Başlangıç: ${startDate}`);
  console.log(`Bitiş: ${endDate}`);
  console.log("Viasat History CMS ID: 246054");

  const channelResults = [];

  for (let i = 0; i < CHANNELS.length; i++) {
    const channel = CHANNELS[i];

    const result = await fetchChannel(
      channel,
      startDate,
      endDate
    );

    channelResults.push(result);

    if (i < CHANNELS.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const { xml, totalPrograms } = buildXml(channelResults);

  validateXml(
    xml,
    CHANNELS.length,
    totalPrograms
  );

  fs.writeFileSync(TEMP_FILE, xml, "utf8");

  const savedXml = fs.readFileSync(TEMP_FILE, "utf8");

  validateXml(
    savedXml,
    CHANNELS.length,
    totalPrograms
  );

  fs.renameSync(TEMP_FILE, OUTPUT_FILE);

  console.log("--------------------------------------");
  console.log("EPG başarıyla oluşturuldu.");
  console.log(`Toplam kanal: ${CHANNELS.length}`);
  console.log(`Toplam program: ${totalPrograms}`);
  console.log("Dosya: dsmart.xml");
  console.log("======================================");
}

main().catch(error => {
  console.error("D-SMART EPG HATASI:");
  console.error(error.message);

  try {
    if (fs.existsSync(TEMP_FILE)) {
      fs.unlinkSync(TEMP_FILE);
    }
  } catch (cleanupError) {
    console.error(
      "Geçici dosya temizlenemedi:",
      cleanupError.message
    );
  }

  console.error("Mevcut dsmart.xml korunuyor.");
  process.exitCode = 1;
});
