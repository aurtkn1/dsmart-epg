const fs = require("fs")

const BASE_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules"

const PAGE_LIMIT = 10
const DAYS = 7

const REQUEST_DELAY = 100

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


async function fetchJson(day, page) {
  const url =
    `${BASE_URL}?page=${page}` +
    `&limit=${PAGE_LIMIT}` +
    `&day=${day}`

  const response = await fetch(url, {
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
        "XMLHttpRequest"
    }
  })

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    )
  }

  return await response.json()
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
        cleanText(object[field])

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

  /*
   Örnek:
   00:45:00
   01:20:30
   */

  let durationText = text

  if (
    durationText.includes(",")
  ) {
    const pieces =
      durationText.split(",")

    durationText =
      pieces[pieces.length - 1].trim()
  }

  const parts =
    durationText
      .split(":")
      .map(Number)

  if (
    parts.length !== 3 ||
    parts.some(
      value => Number.isNaN(value)
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

D-Smart API yapısı değişirse sadece
channel.schedule'a bağlı kalmaz.
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
          return value[nestedField]
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

Hem eski D-Smart formatını hem de
alternatif formatları destekler.
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
       Eski format:
       day
       start_date
       duration
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

        if (firstStart === null) {
          firstStart =
            startDate

          /*
           D-Smart'ın day + start_date
           kombinasyonundaki saat farkını
           koruyoruz.
           */

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
       Alternatif format:
       start + duration
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
       Alternatif:
       start + end
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

  const first =
    await fetchJson(
      day,
      1
    )

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

  if (
    Array.isArray(
      first?.data?.channels
    )
  ) {
    channels.push(
      ...first.data.channels
    )
  }

  for (
    let page = 2;
    page <= pages;
    page++
  ) {
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

    await sleep(
      REQUEST_DELAY
    )
  }

  console.log(
    `${day}: ${channels.length} kanal alındı`
  )

  return channels
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

  /*
   Tarihi UTC yerine lokal takvim üzerinden
   oluşturuyoruz.
   */

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

  const days =
    getDays()

  const allPrograms = []

  const channelNames = {}

  for (
    const day
    of days
  ) {
    console.log(
      `Gün: ${day}`
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
     Eğer yine 0 ise API yapısını
     terminalde açıkça göster.
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
        Object.keys(
          sample
        )
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
   DUPLICATE TEMİZLE
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
   PROGRAM YOKSA HATA
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
      "181 kanal alınmış olmasına rağmen program bulunamadı."
    )

    console.log(
      "Terminalde yukarıdaki 'İlk kanal örneği' bölümünü kontrol et."
    )

    throw new Error(
      "Hiç D-Smart programı alınamadı."
    )
  }


  /*
   AKTİF KANALLAR
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
   XML
   */

  const xml =
    buildXml(
      programs,
      channelNames
    )

  fs.writeFileSync(
    "dsmart.xml",
    xml,
    "utf8"
  )


  /*
   SONUÇ
   */

  console.log(
    "========================================"
  )

  console.log(
    "D-SMART EPG BAŞARIYLA OLUŞTURULDU"
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
