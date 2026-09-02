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

  const parts =
    text.split(":").map(Number)

  if (parts.length !== 3) {
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


function parseUtc(value) {
  const text =
    String(value || "").trim()

  if (!text) {
    throw new Error(
      "Boş tarih"
    )
  }

  return new Date(text)
}


function parseSchedule(channel) {
  const channelId =
    String(channel._id || "").trim()

  if (!channelId) {
    return []
  }

  if (!Array.isArray(channel.schedule)) {
    return []
  }

  const programs = []

  let dayStart = null
  let ofs = 0

  for (const p of channel.schedule) {
    const title =
      String(
        p.program_name || ""
      ).trim()

    if (!title) {
      continue
    }

    if (!p.day || !p.start_date) {
      continue
    }

    if (!p.duration) {
      continue
    }

    try {
      const baseDate =
        parseUtc(p.day)

      const startDate =
        parseUtc(p.start_date)

      /*
       D-Smart config.js mantığı:

       İlk program:
       dayStart = startDate

       ofs =
       p.day tarihinin
       p.start_date saat bilgisiyle
       oluşturulan zaman - baseDate
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
       Sonraki programlar:

       delta =
       startDate - dayStart
      */

      const delta =
        startDate.getTime() -
        dayStart.getTime()

      /*
       D-Smart:

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

      const duration =
        parseDuration(p.duration)

      const stop =
        new Date(
          start.getTime() +
          duration
        )

      programs.push({
        channel: channelId,
        title,
        description:
          String(
            p.description || ""
          ).trim(),
        genre:
          String(
            p.genre || ""
          ).trim(),
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

  return programs
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
    console.log(
      `D-Smart ${day}: veri yok`
    )

    return []
  }

  const pages =
    Math.ceil(
      total / PAGE_LIMIT
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
  }

  console.log(
    `${day}: ${channels.length} kanal alındı`
  )

  return channels
}


function xmlEscape(value) {
  return String(value || "")
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


function xmltvTime(date) {
  const year =
    date.getUTCFullYear()

  const month =
    String(
      date.getUTCMonth() + 1
    ).padStart(2, "0")

  const day =
    String(
      date.getUTCDate()
    ).padStart(2, "0")

  const hour =
    String(
      date.getUTCHours()
    ).padStart(2, "0")

  const minute =
    String(
      date.getUTCMinutes()
    ).padStart(2, "0")

  const second =
    String(
      date.getUTCSeconds()
    ).padStart(2, "0")

  return (
    `${year}${month}${day}` +
    `${hour}${minute}${second} +0000`
  )
}


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
    const channelId of channelIds
  ) {
    const name =
      channelNames[channelId] ||
      channelId

    xml.push(
      `  <channel id="${xmlEscape(channelId)}">`
    )

    xml.push(
      `    <display-name lang="tr">` +
      `${xmlEscape(name)}` +
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
    const program of programs
  ) {
    xml.push(
      `  <programme ` +
      `start="${xmltvTime(program.start)}" ` +
      `stop="${xmltvTime(program.stop)}" ` +
      `channel="${xmlEscape(program.channel)}">`
    )

    xml.push(
      `    <title lang="tr">` +
      `${xmlEscape(program.title)}` +
      `</title>`
    )

    if (
      program.description
    ) {
      xml.push(
        `    <desc lang="tr">` +
        `${xmlEscape(
          program.description
        )}` +
        `</desc>`
      )
    }

    if (
      program.genre
    ) {
      for (
        const category
        of program.genre.split("/")
      ) {
        const value =
          category.trim()

        if (!value) {
          continue
        }

        xml.push(
          `    <category lang="tr">` +
          `${xmlEscape(value)}` +
          `</category>`
        )
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
  console.log(
    "========================================"
  )

  console.log(
    "D-SMART EPG BAŞLIYOR"
  )

  console.log(
    "========================================"
  )

  /*
   BUGÜN + SONRAKİ 6 GÜN
   TOPLAM 7 GÜN
  */

  const now =
    new Date()

  const days = []

  for (
    let i = 0;
    i < 7;
    i++
  ) {
    const date =
      new Date(
        now.getTime() +
        i *
        24 *
        60 *
        60 *
        1000
      )

    /*
     D-Smart API'ye YYYY-MM-DD
     gönderiyoruz.
    */

    const year =
      date.getUTCFullYear()

    const month =
      String(
        date.getUTCMonth() + 1
      ).padStart(2, "0")

    const day =
      String(
        date.getUTCDate()
      ).padStart(2, "0")

    days.push(
      `${year}-${month}-${day}`
    )
  }

  const allPrograms = []
  const channelNames = {}

  for (
    const day of days
  ) {
    console.log(
      `Gün: ${day}`
    )

    const channels =
      await fetchAllPages(day)

    for (
      const channel of channels
    ) {
      const channelId =
        String(
          channel._id || ""
        ).trim()

      const channelName =
        String(
          channel.channel_name || ""
        ).trim()

      if (
        channelId &&
        channelName
      ) {
        channelNames[channelId] =
          channelName
      }

      const programs =
        parseSchedule(channel)

      allPrograms.push(
        ...programs
      )
    }

    console.log(
      `${day}: ` +
      `${allPrograms.length} toplam program`
    )
  }

  if (!allPrograms.length) {
    throw new Error(
      "Hiç D-Smart programı alınamadı."
    )
  }

  /*
   Aynı programların iki kez gelmesini
   engelle.
  */

  const unique =
    new Map()

  for (
    const program of allPrograms
  ) {
    const key =
      [
        program.channel,
        program.start.getTime(),
        program.stop.getTime(),
        program.title
      ].join("|")

    unique.set(
      key,
      program
    )
  }

  const programs =
    Array.from(
      unique.values()
    )

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
    "========================================"
  )

  console.log(
    "D-SMART EPG BAŞARIYLA OLUŞTURULDU"
  )

  console.log(
    `Program: ${programs.length}`
  )

  console.log(
    `Kanal: ${Object.keys(channelNames).length}`
  )

  console.log(
    "Gün sayısı: 7"
  )

  console.log(
    "========================================"
  )
}


main().catch(error => {
  console.error(
    "D-SMART EPG HATASI:"
  )

  console.error(
    error
  )

  process.exit(1)
})
