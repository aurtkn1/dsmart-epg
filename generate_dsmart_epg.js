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


function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}


function getChannelName(channel) {
  /*
   D-Smart API kanal adını farklı alanlarda
   döndürebilir. Önce channel_name kullanılıyor,
   yoksa alternatif alanlar kontrol ediliyor.
  */

  const candidates = [
    channel.channel_name,
    channel.name,
    channel.channelName,
    channel.title,
    channel.display_name,
    channel.displayName,
    channel.label
  ]

  for (const value of candidates) {
    const name = cleanText(value)

    if (name) {
      return name
    }
  }

  return ""
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
      cleanText(
        p.program_name
      )

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

      const delta =
        startDate.getTime() -
        dayStart.getTime()

      const start =
        new Date(
          baseDate.getTime() +
          ofs +
          delta
        )

      const duration =
        parseDuration(
          p.duration
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
      cleanText(
        channelNames[channelId]
      ) || channelId

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
    (a, b) => {
      const timeDifference =
        a.start.getTime() -
        b.start.getTime()

      if (timeDifference !== 0) {
        return timeDifference
      }

      return a.channel.localeCompare(
        b.channel
      )
    }
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


function getDays() {
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

  return days
}


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

  /*
   Eğer daha önce boş veya sadece ID varsa
   gerçek kanal adıyla değiştir.
  */

  if (
    !oldName ||
    oldName === channelId
  ) {
    channelNames[channelId] = name
    return
  }

  /*
   Önceki isim zaten gerçek bir isimse
   koru.
  */
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

  const days =
    getDays()

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

      if (!channelId) {
        continue
      }

      addChannelName(
        channelNames,
        channelId,
        channel
      )

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
   Aynı programların tekrarını temizle.
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

    if (!unique.has(key)) {
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
   Sadece programı bulunan kanallar
   XML'e yazılır.
  */

  const activeChannelIds =
    new Set(
      programs.map(
        p => p.channel
      )
    )

  for (
    const channelId of activeChannelIds
  ) {
    if (
      !channelNames[channelId]
    ) {
      channelNames[channelId] =
        channelId
    }
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
