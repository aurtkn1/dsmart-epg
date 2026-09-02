const fs = require("fs")

const BASE_URL =
  "https://www.dsmart.com.tr/api/v1/public/epg/schedules"

const PAGE_LIMIT = 10


async function fetchJson(day, page) {
  const url =
    `${BASE_URL}?page=${page}` +
    `&limit=${PAGE_LIMIT}` +
    `&day=${day}`

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept":
        "application/json, text/javascript, */*; q=0.01",
      "Referer": "https://www.dsmart.com.tr/",
      "X-Requested-With": "XMLHttpRequest"
    }
  })

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    )
  }

  return await response.json()
}


function parseDuration(value) {
  let text = String(value || "").trim()

  if (text.includes(",")) {
    text = text.split(",", 2)[1].trim()
  }

  const parts = text.split(":").map(Number)

  if (parts.length !== 3) {
    throw new Error(
      `Geçersiz duration: ${value}`
    )
  }

  return (
    (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    ) * 1000
  )
}


function parseUtc(value) {
  const text = String(value || "").trim()

  if (!text) {
    throw new Error("Boş tarih")
  }

  return new Date(text)
}


/*
 D-Smart config.js mantığı:

 baseDate = p.day
 startDate = p.start_date

 İlk program:
 dayStart = startDate
 ofs = day + startDate saat farkı

 Sonraki programlar:
 delta = startDate - dayStart

 start = baseDate + ofs + delta
 stop = start + duration
*/

function parseSchedule(channel) {
  const channelId =
    String(channel._id || "").trim()

  if (!channelId) {
    return []
  }

  if (!Array.isArray(channel.schedule)) {
    return []
  }

  const result = []

  let dayStart = null
  let ofs = 0

  for (const p of channel.schedule) {
    const title =
      String(p.program_name || "").trim()

    if (!title) {
      continue
    }

    try {
      const baseDate =
        parseUtc(p.day)

      const startDate =
        parseUtc(p.start_date)

      const duration =
        parseDuration(p.duration)

      /*
       config.js'deki ilk program hesabı
      */

      if (dayStart === null) {
        dayStart = startDate

        const combined =
          String(p.day).slice(0, 11) +
          String(p.start_date).slice(11)

        const combinedDate =
          parseUtc(combined)

        ofs =
          combinedDate.getTime() -
          baseDate.getTime()
      }

      /*
       delta =
       startDate - dayStart
      */

      const delta =
        startDate.getTime() -
        dayStart.getTime()

      /*
       start =
       baseDate + ofs + delta
      */

      const start =
        new Date(
          baseDate.getTime() +
          ofs +
          delta
        )

      /*
       stop =
       start + duration
      */

      const stop =
        new Date(
          start.getTime() +
          duration
        )

      result.push({
        channel: channelId,
        title,
        description:
          String(p.description || "").trim(),
        genre:
          String(p.genre || "").trim(),
        start,
        stop
      })

    } catch (error) {
      console.log(
        `Program atlandı: ${title}`
      )

      console.log(
        error.message
      )
    }
  }

  return result
}


async function fetchAllPages(day) {
  console.log(
    `D-Smart ${day} indiriliyor...`
  )

  const first =
    await fetchJson(day, 1)

  const total =
    Number(
      first?.data?.total || 0
    )

  if (!total) {
    return []
  }

  const pages =
    Math.ceil(
      total / PAGE_LIMIT
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
    console.log(
      `Sayfa ${page}/${pages}`
    )

    const data =
      await fetchJson(
        day,
        page
      )

    if (
      Array.isArray(
        data?.data?.channels
      )
    ) {
      channels.push(
        ...data.data.channels
      )
    }
  }

  return channels
}


function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}


function xmltvTime(date) {
  /*
   D-Smart'ın parser sonucu UTC'dir.

   Örneğin:
   2026-09-02T14:40:00.000Z

   XMLTV:
   20260902144000 +0000
  */

  return (
    date.toISOString()
      .replace(
        /[-:T]/g,
        ""
      )
      .replace(
        /\.\d{3}Z$/,
        " +0000"
      )
  )
}


function buildXml(programs, channelNames) {
  const xml = []

  xml.push(
    '<?xml version="1.0" encoding="UTF-8"?>'
  )

  xml.push(
    '<tv generator-info-name="D-Smart EPG">'
  )

  const channelIds = [
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
    xml.push(
      `  <channel id="${xmlEscape(channelId)}">`
    )

    xml.push(
      `    <display-name lang="tr">` +
      `${xmlEscape(
        channelNames[channelId] ||
        channelId
      )}` +
      `</display-name>`
    )

    xml.push(
      "  </channel>"
    )
  }

  programs.sort(
    (a, b) =>
      a.start.getTime() -
      b.start.getTime()
  )

  for (
    const p of programs
  ) {
    xml.push(
      `  <programme ` +
      `start="${xmltvTime(p.start)}" ` +
      `stop="${xmltvTime(p.stop)}" ` +
      `channel="${xmlEscape(p.channel)}">`
    )

    xml.push(
      `    <title lang="tr">` +
      `${xmlEscape(p.title)}` +
      `</title>`
    )

    if (p.description) {
      xml.push(
        `    <desc lang="tr">` +
        `${xmlEscape(p.description)}` +
        `</desc>`
      )
    }

    if (p.genre) {
      for (
        const category
        of p.genre.split("/")
      ) {
        const value =
          category.trim()

        if (value) {
          xml.push(
            `    <category lang="tr">` +
            `${xmlEscape(value)}` +
            `</category>`
          )
        }
      }
    }

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


async function main() {
  const now = new Date()

  const today =
    now.toISOString()
      .slice(0, 10)

  const tomorrowDate =
    new Date(
      now.getTime() +
      24 * 60 * 60 * 1000
    )

  const tomorrow =
    tomorrowDate
      .toISOString()
      .slice(0, 10)

  const days = [
    today,
    tomorrow
  ]

  const programs = []
  const channelNames = {}

  for (
    const day
    of days
  ) {
    const channels =
      await fetchAllPages(day)

    console.log(
      `${day}: ` +
      `${channels.length} kanal`
    )

    for (
      const channel
      of channels
    ) {
      const id =
        String(
          channel._id || ""
        ).trim()

      const name =
        String(
          channel.channel_name || ""
        ).trim()

      if (id && name) {
        channelNames[id] =
          name
      }

      const parsed =
        parseSchedule(channel)

      programs.push(
        ...parsed
      )
    }
  }

  if (!programs.length) {
    throw new Error(
      "Hiç program alınamadı."
    )
  }

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

  console.log(
    "D-Smart EPG başarıyla oluşturuldu."
  )

  console.log(
    `Toplam program: ${programs.length}`
  )
}


main().catch(error => {
  console.error(error)
  process.exit(1)
})
