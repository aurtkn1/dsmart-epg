const fs = require("fs")

const BASE_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules"

const PAGE_LIMIT = 10
const DAYS = 7

// Sayfalar arasında kısa bekleme
const REQUEST_DELAY = 150

// Her HTTP isteğinin maksimum bekleme süresi
const REQUEST_TIMEOUT = 20000

// Başarısız istek için maksimum tekrar sayısı
const MAX_RETRIES = 4

// Retry bekleme süreleri
const RETRY_DELAYS = [
  1000,
  2500,
  5000,
  10000
]


/*
==================================================
GENEL
==================================================
*/

async function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  )
}


/*
==================================================
FETCH JSON
==================================================

- Timeout var
- HTTP 500 retry var
- 502/503/504 retry var
- Network hataları retry var
- Son denemede hata varsa throw eder
==================================================
*/

async function fetchJson(day, page) {
  const url =
    `${BASE_URL}?page=${page}` +
    `&limit=${PAGE_LIMIT}` +
    `&day=${day}`

  let lastError = null

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {

    const controller =
      new AbortController()

    const timeout =
      setTimeout(() => {
        controller.abort()
      }, REQUEST_TIMEOUT)

    try {

      console.log(
        `  Sayfa ${page}/${page} | deneme ${attempt}/${MAX_RETRIES}`
      )

      const response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",

              "Accept":
                "application/json, text/javascript, */*; q=0.01",

              "Accept-Language":
                "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",

              "Referer":
                "https://www.dsmart.com.tr/",

              "X-Requested-With":
                "XMLHttpRequest",

              "Cache-Control":
                "no-cache",

              "Pragma":
                "no-cache"
            },

            signal:
              controller.signal
          }
        )

      clearTimeout(timeout)

      /*
      ------------------------------------------
      HTTP BAŞARISIZ
      ------------------------------------------
      */

      if (!response.ok) {

        const status =
          response.status

        const error =
          new Error(
            `HTTP ${status}: ${url}`
          )

        lastError = error

        /*
        Retry yapılabilecek HTTP kodları
        */

        const retryable =
          status === 408 ||
          status === 425 ||
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504

        if (
          retryable &&
          attempt < MAX_RETRIES
        ) {

          const wait =
            RETRY_DELAYS[
              attempt - 1
            ] || 10000

          console.log(
            `  HTTP ${status} -> ${wait / 1000} saniye sonra tekrar denenecek`
          )

          await sleep(wait)

          continue
        }

        throw error
      }


      /*
      ------------------------------------------
      JSON
      ------------------------------------------
      */

      const text =
        await response.text()

      if (!text) {
        throw new Error(
          `Boş HTTP cevabı: ${url}`
        )
      }

      let json

      try {
        json =
          JSON.parse(text)
      } catch (jsonError) {

        throw new Error(
          `JSON parse hatası: ${url}`
        )
      }

      console.log(
        `  Sayfa ${page} başarılı`
      )

      return json

    } catch (error) {

      clearTimeout(timeout)

      lastError = error

      let message =
        error?.message ||
        String(error)

      /*
      AbortController timeout
      */

      if (
        error?.name === "AbortError"
      ) {
        message =
          `TIMEOUT (${REQUEST_TIMEOUT / 1000}s)`
      }

      console.log(
        `  Sayfa ${page} hata: ${message}`
      )

      /*
      ------------------------------------------
      RETRY
      ------------------------------------------
      */

      if (
        attempt < MAX_RETRIES
      ) {

        const wait =
          RETRY_DELAYS[
            attempt - 1
          ] || 10000

        console.log(
          `  ${wait / 1000} saniye sonra tekrar denenecek`
        )

        await sleep(wait)

        continue
      }
    }
  }

  /*
  ------------------------------------------
  TÜM DENEMELER BİTTİ
  ------------------------------------------
  */

  throw (
    lastError ||
    new Error(
      `İstek başarısız: ${url}`
    )
  )
}


/*
==================================================
GENEL YARDIMCI FONKSİYONLAR
==================================================
*/

function cleanText(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return ""
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
}


function firstValue(object, fields) {

  if (
    !object ||
    typeof object !== "object"
  ) {
    return ""
  }

  for (
    const field of fields
  ) {

    if (
      object[field] !== undefined &&
      object[field] !== null
    ) {

      const value =
        cleanText(
          object[field]
        )

      if (value) {
        return value
      }
    }
  }

  return ""
}


function getChannelName(channel) {

  return firstValue(
    channel,
    [
      "channel_name",
      "name",
      "channelName",
      "title",
      "display_name",
      "displayName",
      "label"
    ]
  )
}


function getChannelId(channel) {

  return cleanText(
    channel?._id ||
    channel?.id ||
    channel?.channel_id ||
    channel?.channelId
  )
}


/*
==================================================
DURATION
==================================================
*/

function parseDuration(value) {

  const text =
    cleanText(value)

  if (!text) {
    throw new Error(
      "Boş duration"
    )
  }

  let durationText =
    text

  if (
    durationText.includes(",")
  ) {

    const pieces =
      durationText.split(",")

    durationText =
      pieces[
        pieces.length - 1
      ].trim()
  }

  const parts =
    durationText
      .split(":")
      .map(Number)

  if (
    parts.length !== 3 ||
    parts.some(
      value =>
        Number.isNaN(value)
    )
  ) {

    throw new Error(
      `Geçersiz duration: ${value}`
    )
  }

  const [
    hours,
    minutes,
    seconds
  ] = parts

  return (
    (
      hours * 3600 +
      minutes * 60 +
      seconds
    ) * 1000
  )
}


/*
==================================================
TARİH
==================================================
*/

function parseUtc(value) {

  const text =
    cleanText(value)

  if (!text) {
    throw new Error(
      "Boş tarih"
    )
  }

  const date =
    new Date(text)

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    throw new Error(
      `Geçersiz tarih: ${value}`
    )
  }

  return date
}


/*
==================================================
SCHEDULE BULUCU
==================================================
*/

function findSchedule(channel) {

  if (!channel) {
    return []
  }

  const possibleFields = [
    "schedule",
    "schedules",
    "programs",
    "program",
    "broadcasts",
    "broadcast",
    "epg",
    "events",
    "items"
  ]

  for (
    const field of possibleFields
  ) {

    const value =
      channel[field]

    if (
      Array.isArray(value) &&
      value.length > 0
    ) {
      return value
    }

    if (
      value &&
      typeof value === "object"
    ) {

      const nestedFields = [
        "schedule",
        "schedules",
        "programs",
        "broadcasts",
        "events",
        "items",
        "data"
      ]

      for (
        const nestedField
        of nestedFields
      ) {

        if (
          Array.isArray(
            value[nestedField]
          )
        ) {

          return value[
            nestedField
          ]
        }
      }
    }
  }

  return []
}


/*
==================================================
PROGRAM ALANLARI
==================================================
*/

function getProgramTitle(program) {

  return firstValue(
    program,
    [
      "program_name",
      "programName",
      "title",
      "name",
      "broadcast_name",
      "broadcastName",
      "event_name",
      "eventName",
      "programme",
      "program"
    ]
  )
}


function getProgramStart(program) {

  return firstValue(
    program,
    [
      "start_date",
      "startDate",
      "start_time",
      "startTime",
      "start",
      "begin",
      "from"
    ]
  )
}


function getProgramDay(program) {

  return firstValue(
    program,
    [
      "day",
      "date",
      "broadcast_day",
      "broadcastDay"
    ]
  )
}


function getProgramDuration(program) {

  return firstValue(
    program,
    [
      "duration",
      "length",
      "runtime"
    ]
  )
}


/*
==================================================
SCHEDULE PARSE
==================================================
*/

function parseSchedule(channel) {

  const channelId =
    getChannelId(channel)

  if (!channelId) {
    return []
  }

  const schedule =
    findSchedule(channel)

  if (!schedule.length) {
    return []
  }

  const programs = []

  let firstStart = null
  let offset = null

  for (
    const program
    of schedule
  ) {

    try {

      const title =
        getProgramTitle(program)

      if (!title) {
        continue
      }

      const startValue =
        getProgramStart(program)

      const dayValue =
        getProgramDay(program)

      const durationValue =
        getProgramDuration(program)


      /*
      ------------------------------------------
      ESKİ FORMAT
      ------------------------------------------
      */

      if (
        dayValue &&
        startValue &&
        durationValue
      ) {

        const baseDate =
          parseUtc(dayValue)

        const startDate =
          parseUtc(startValue)

        if (
          firstStart === null
        ) {

          firstStart =
            startDate

          const dayText =
            String(dayValue)

          const startText =
            String(startValue)

          let combined

          if (
            dayText.length >= 11 &&
            startText.length >= 11
          ) {

            combined =
              dayText.slice(0, 11) +
              startText.slice(11)
          }

          if (combined) {

            const combinedDate =
              parseUtc(combined)

            offset =
              combinedDate.getTime() -
              baseDate.getTime()

          } else {

            offset = 0
          }
        }

        const delta =
          startDate.getTime() -
          firstStart.getTime()

        const start =
          new Date(
            baseDate.getTime() +
            (offset || 0) +
            delta
          )

        const duration =
          parseDuration(
            durationValue
          )

        const stop =
          new Date(
            start.getTime() +
            duration
          )

        programs.push({
          channel: channelId,
          title,
          start,
          stop
        })

        continue
      }


      /*
      ------------------------------------------
      ALTERNATİF FORMAT
      START + DURATION
      ------------------------------------------
      */

      if (
        startValue &&
        durationValue
      ) {

        const start =
          parseUtc(startValue)

        const duration =
          parseDuration(
            durationValue
          )

        const stop =
          new Date(
            start.getTime() +
            duration
          )

        programs.push({
          channel: channelId,
          title,
          start,
          stop
        })

        continue
      }


      /*
      ------------------------------------------
      START + END
      ------------------------------------------
      */

      const endValue =
        firstValue(
          program,
          [
            "end_date",
            "endDate",
            "end_time",
            "endTime",
            "end",
            "stop",
            "to"
          ]
        )

      if (
        startValue &&
        endValue
      ) {

        const start =
          parseUtc(startValue)

        const stop =
          parseUtc(endValue)

        if (
          stop.getTime() >
          start.getTime()
        ) {

          programs.push({
            channel: channelId,
            title,
            start,
            stop
          })
        }
      }

    } catch (error) {

      console.log(
        `Program atlandı: ${getProgramTitle(program) || "Bilinmeyen"}`
      )

      console.log(
        error.message
      )
    }
  }

  return programs
}


/*
==================================================
TÜM SAYFALAR
==================================================
*/

async function fetchAllPages(day) {

  console.log(
    `D-Smart ${day} indiriliyor...`
  )

  /*
  ------------------------------------------
  İLK SAYFA
  ------------------------------------------
  */

  let first

  try {

    first =
      await fetchJson(
        day,
        1
      )

  } catch (error) {

    console.log("")
    console.log(
      `!!! ${day} ilk sayfa alınamadı !!!`
    )

    console.log(
      error.message
    )

    console.log(
      `${day} günü atlanıyor.`
    )

    return []
  }


  const total =
    Number(
      first?.data?.total || 0
    )

  if (!total) {

    console.log(
      `D-Smart ${day}: veri yok`
    )

    return []
  }


  const pages =
    Math.ceil(
      total /
      PAGE_LIMIT
    )

  console.log(
    `Toplam kanal: ${total}`
  )

  console.log(
    `Toplam sayfa: ${pages}`
  )


  const channels = []


  /*
  ------------------------------------------
  İLK SAYFA KANALLARI
  ------------------------------------------
  */

  if (
    Array.isArray(
      first?.data?.channels
    )
  ) {

    channels.push(
      ...first.data.channels
    )
  }


  /*
  ------------------------------------------
  DİĞER SAYFALAR
  ------------------------------------------
  */

  for (
    let page = 2;
    page <= pages;
    page++
  ) {

    try {

      const result =
        await fetchJson(
          day,
          page
        )

      if (
        Array.isArray(
          result?.data?.channels
        )
      ) {

        channels.push(
          ...result.data.channels
        )
      }

    } catch (error) {

      /*
      ----------------------------------------
      ÖNEMLİ:
      TEK SAYFA HATA VERİRSE TÜM GÜNÜ
      ÖLDÜRMÜYORUZ.
      ----------------------------------------
      */

      console.log("")
      console.log(
        `!!! ${day} page=${page} ATLANDI !!!`
      )

      console.log(
        error.message
      )

      console.log(
        "Diğer sayfalarla devam ediliyor."
      )

      console.log("")
    }


    await sleep(
      REQUEST_DELAY
    )
  }


  /*
  ------------------------------------------
  DUPLICATE KANAL TEMİZLE
  ------------------------------------------
  */

  const uniqueChannels =
    new Map()

  for (
    const channel
    of channels
  ) {

    const id =
      getChannelId(channel)

    if (!id) {
      continue
    }

    if (
      !uniqueChannels.has(id)
    ) {

      uniqueChannels.set(
        id,
        channel
      )
    }
  }


  const result =
    Array.from(
      uniqueChannels.values()
    )


  console.log(
    `${day}: ${result.length} kanal alındı`
  )

  if (
    result.length !== total
  ) {

    console.log(
      `${day}: ${total - result.length} kanal eksik`
    )
  }


  return result
}


/*
==================================================
XML ESCAPE
==================================================
*/

function xmlEscape(value) {

  return String(
    value || ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&apos;"
    )
}


/*
==================================================
XMLTV TARİH
==================================================
*/

function xmltvTime(date) {

  const year =
    date.getUTCFullYear()

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(
      2,
      "0"
    )

  const day =
    String(
      date.getUTCDate()
    ).padStart(
      2,
      "0"
    )

  const hour =
    String(
      date.getUTCHours()
    ).padStart(
      2,
      "0"
    )

  const minute =
    String(
      date.getUTCMinutes()
    ).padStart(
      2,
      "0"
    )

  const second =
    String(
      date.getUTCSeconds()
    ).padStart(
      2,
      "0"
    )

  return (
    `${year}${month}${day}` +
    `${hour}${minute}${second} +0000`
  )
}


/*
==================================================
XML OLUŞTUR
==================================================
*/

function buildXml(
  programs,
  channelNames
) {

  const xml = []

  xml.push(
    '<?xml version="1.0" encoding="UTF-8"?>'
  )

  xml.push(
    '<tv generator-info-name="D-Smart EPG">'
  )


  const channelIds =
    [
      ...new Set(
        programs.map(
          p => p.channel
        )
      )
    ].sort()


  for (
    const channelId
    of channelIds
  ) {

    const name =
      cleanText(
        channelNames[channelId]
      ) ||
      channelId

    xml.push(
      `  <channel id="${xmlEscape(channelId)}">`
    )

    xml.push(
      `    <display-name lang="tr">${xmlEscape(name)}</display-name>`
    )

    xml.push(
      "  </channel>"
    )
  }


  programs.sort(
    (a, b) => {

      const difference =
        a.start.getTime() -
        b.start.getTime()

      if (
        difference !== 0
      ) {
        return difference
      }

      return a.channel.localeCompare(
        b.channel
      )
    }
  )


  for (
    const program
    of programs
  ) {

    xml.push(
      `  <programme ` +
      `start="${xmltvTime(program.start)}" ` +
      `stop="${xmltvTime(program.stop)}" ` +
      `channel="${xmlEscape(program.channel)}">`
    )

    xml.push(
      `    <title lang="tr">${xmlEscape(program.title)}</title>`
    )

    xml.push(
      "  </programme>"
    )
  }


  xml.push(
    "</tv>"
  )

  return (
    xml.join("\n") +
    "\n"
  )
}


/*
==================================================
GÜNLER
==================================================
*/

function getDays() {

  const days = []

  const now =
    new Date()

  for (
    let i = 0;
    i < DAYS;
    i++
  ) {

    const date =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + i
      )

    const year =
      date.getFullYear()

    const month =
      String(
        date.getMonth() + 1
      ).padStart(
        2,
        "0"
      )

    const day =
      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      )

    days.push(
      `${year}-${month}-${day}`
    )
  }

  return days
}


/*
==================================================
KANAL ADI
==================================================
*/

function addChannelName(
  channelNames,
  channelId,
  channel
) {

  const name =
    getChannelName(channel)

  if (
    !channelId ||
    !name
  ) {
    return
  }

  const oldName =
    cleanText(
      channelNames[channelId]
    )

  if (
    !oldName ||
    oldName === channelId
  ) {

    channelNames[channelId] =
      name
  }
}


/*
==================================================
ANA FONKSİYON
==================================================
*/

async function main() {

  console.log(
    "========================================"
  )

  console.log(
    "D-SMART EPG BAŞLIYOR"
  )

  console.log(
    "========================================"
  )

  console.log(
    `Timeout: ${REQUEST_TIMEOUT / 1000} saniye`
  )

  console.log(
    `Max retry: ${MAX_RETRIES}`
  )

  console.log(
    `Gün sayısı: ${DAYS}`
  )

  console.log(
    "========================================"
  )


  const days =
    getDays()

  const allPrograms = []

  const channelNames = {}


  for (
    const day
    of days
  ) {

    console.log("")
    console.log(
      `Gün: ${day}`
    )
    console.log(
      "----------------------------------------"
    )


    const channels =
      await fetchAllPages(
        day
      )


    let dayPrograms = 0

    let channelsWithSchedule = 0


    for (
      const channel
      of channels
    ) {

      const channelId =
        getChannelId(channel)

      if (!channelId) {
        continue
      }


      addChannelName(
        channelNames,
        channelId,
        channel
      )


      const schedule =
        findSchedule(
          channel
        )

      if (
        schedule.length > 0
      ) {

        channelsWithSchedule++
      }


      const programs =
        parseSchedule(
          channel
        )

      dayPrograms +=
        programs.length

      allPrograms.push(
        ...programs
      )
    }


    console.log(
      `${day}: ${dayPrograms} program`
    )

    console.log(
      `${day}: ${channelsWithSchedule} kanalda program verisi bulundu`
    )


    /*
    ------------------------------------------
    API YAPISI DEĞİŞMİŞSE ÖRNEK GÖSTER
    ------------------------------------------
    */

    if (
      dayPrograms === 0 &&
      channels.length > 0
    ) {

      console.log("")

      console.log(
        "UYARI: Kanal geldi fakat program alanı bulunamadı."
      )

      const sample =
        channels[0]

      console.log(
        "İlk kanalın alanları:"
      )

      console.log(
        Object.keys(sample)
      )

      console.log(
        "İlk kanal örneği:"
      )

      console.log(
        JSON.stringify(
          sample,
          null,
          2
        ).slice(
          0,
          8000
        )
      )

      console.log("")
    }
  }


  /*
  ==================================================
  DUPLICATE TEMİZLE
  ==================================================
  */

  const unique =
    new Map()


  for (
    const program
    of allPrograms
  ) {

    const key =
      [
        program.channel,
        program.start.getTime(),
        program.stop.getTime(),
        program.title
      ].join("|")


    if (
      !unique.has(key)
    ) {

      unique.set(
        key,
        program
      )
    }
  }


  const programs =
    Array.from(
      unique.values()
    )


  /*
  ==================================================
  PROGRAM YOKSA ESKİ XML'İ EZME
  ==================================================
  */

  if (
    !programs.length
  ) {

    console.log("")

    console.log(
      "========================================"
    )

    console.log(
      "D-SMART EPG HATASI"
    )

    console.log(
      "========================================"
    )

    console.log(
      "Hiç program alınamadı."
    )

    console.log(
      "Mevcut dsmart.xml korunuyor."
    )

    throw new Error(
      "Hiç D-Smart programı alınamadı."
    )
  }


  /*
  ==================================================
  AKTİF KANALLAR
  ==================================================
  */

  const activeChannelIds =
    new Set(
      programs.map(
        p => p.channel
      )
    )


  for (
    const channelId
    of activeChannelIds
  ) {

    if (
      !channelNames[channelId]
    ) {

      channelNames[channelId] =
        channelId
    }
  }


  /*
  ==================================================
  XML
  ==================================================
  */

  const xml =
    buildXml(
      programs,
      channelNames
    )


  /*
  Geçici dosyaya yaz.
  Böylece XML oluşturulurken işlem
  yarıda kalırsa mevcut dosya bozulmaz.
  */

  const tempFile =
    "dsmart.xml.tmp"

  fs.writeFileSync(
    tempFile,
    xml,
    "utf8"
  )


  /*
  Dosyanın gerçekten dolu olduğunu kontrol et
  */

  const fileSize =
    fs.statSync(
      tempFile
    ).size

  if (
    fileSize < 100
  ) {

    fs.unlinkSync(
      tempFile
    )

    throw new Error(
      "Oluşturulan dsmart.xml geçersiz veya boş."
    )
  }


  /*
  Eski dosyanın yerine geç
  */

  fs.renameSync(
    tempFile,
    "dsmart.xml"
  )


  /*
  ==================================================
  SONUÇ
  ==================================================
  */

  console.log("")

  console.log(
    "========================================"
  )

  console.log(
    "D-SMART EPG BAŞARIYLA OLUŞTURULDU"
  )

  console.log(
    "========================================"
  )

  console.log(
    `Program: ${programs.length}`
  )

  console.log(
    `Kanal: ${activeChannelIds.size}`
  )

  console.log(
    `Gün sayısı: ${DAYS}`
  )

  console.log(
    `Dosya boyutu: ${fileSize} byte`
  )

  console.log(
    "Dosya: dsmart.xml"
  )

  console.log(
    "========================================"
  )
}


/*
==================================================
HATA YAKALAMA
==================================================
*/

main().catch(
  error => {

    console.error("")

    console.error(
      "D-SMART EPG HATASI:"
    )

    console.error("")

    console.error(
      error.message ||
      error
    )

    console.error("")

    process.exit(1)
  }
)
