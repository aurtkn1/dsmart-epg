import json
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape


BASE_URL = (
    "https://www.dsmart.com.tr/"
    "api/v1/public/epg/schedules"
)

PAGE_LIMIT = 10


def fetch_json(day, page):
    url = (
        f"{BASE_URL}"
        f"?page={page}"
        f"&limit={PAGE_LIMIT}"
        f"&day={day}"
    )

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": (
                "application/json, "
                "text/javascript, */*; q=0.01"
            ),
            "Referer": (
                "https://www.dsmart.com.tr/"
            ),
            "X-Requested-With": "XMLHttpRequest",
        },
    )

    context = ssl.create_default_context()

    with urllib.request.urlopen(
        request,
        timeout=30,
        context=context,
    ) as response:
        raw = response.read().decode("utf-8")

    data = json.loads(raw)

    if not isinstance(data, dict):
        raise ValueError(
            "D-Smart geçerli JSON döndürmedi."
        )

    return data


def clean_text(value):
    if value is None:
        return ""

    return " ".join(
        str(value)
        .replace("\r", " ")
        .replace("\n", " ")
        .split()
    )


def parse_iso_utc(value):
    text = clean_text(value)

    if not text:
        raise ValueError(
            "Boş tarih"
        )

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    dt = datetime.fromisoformat(text)

    if dt.tzinfo is None:
        dt = dt.replace(
            tzinfo=timezone.utc
        )

    return dt.astimezone(
        timezone.utc
    )


def parse_duration(value):
    text = clean_text(value)

    if not text:
        raise ValueError(
            "Boş duration"
        )

    # D-Smart örnekleri:
    #
    # 2:00:00
    # 1:45:00
    # 17 days, 2:00:00
    #
    if "," in text:
        text = text.split(
            ",",
            1
        )[1].strip()

    parts = text.split(":")

    if len(parts) != 3:
        raise ValueError(
            f"Geçersiz duration: {value}"
        )

    hours = int(parts[0])
    minutes = int(parts[1])
    seconds = int(parts[2])

    return timedelta(
        hours=hours,
        minutes=minutes,
        seconds=seconds,
    )


def build_dsmart_start(
    base_date,
    start_date,
    day_start,
):
    """
    D-Smart config.js mantığının karşılığı.

    JavaScript:

      const baseDate = dayjs.utc(p.day)
      const startDate = dayjs.utc(p.start_date)

      if (!dayStart) {
        dayStart = startDate
        ofs = dayjs.duration(
          dayjs.utc(
            `${p.day.substr(0, 11)}${p.start_date.substr(11)}`
          ).diff(baseDate)
        ).asSeconds()
      }

      const delta = dayjs.duration(
        startDate.diff(dayStart)
      ).asSeconds()

      const start = baseDate.add(
        ofs + delta,
        's'
      )

    Python karşılığı:
    """

    # JavaScript'in:
    #
    # p.day.substr(0, 11)
    # +
    # p.start_date.substr(11)
    #
    # davranışını aynen uyguluyoruz.

    day_text = clean_text(
        base_date.isoformat()
    )

    start_text = clean_text(
        start_date.isoformat()
    )

    # ISO'da örneğin:
    #
    # 2025-01-13T21:00:00+00:00
    #
    # ilk 11 karakter:
    #
    # 2025-01-13T
    #
    # start_date'in 11. karakterinden sonrası:
    #
    # 21:30:00+00:00

    combined_text = (
        day_text[:11]
        + start_text[11:]
    )

    combined = parse_iso_utc(
        combined_text
    )

    # ofs = combined - baseDate
    ofs = (
        combined
        - base_date
    )

    # delta = startDate - dayStart
    delta = (
        start_date
        - day_start
    )

    return (
        base_date
        + ofs
        + delta
    )


def parse_channel_schedule(channel):
    channel_id = clean_text(
        channel.get("_id")
    )

    schedule = channel.get(
        "schedule",
        []
    )

    if not channel_id:
        return []

    if not isinstance(schedule, list):
        return []

    results = []

    day_start = None

    for item in schedule:
        if not isinstance(item, dict):
            continue

        program_name = clean_text(
            item.get("program_name")
        )

        p_day = clean_text(
            item.get("day")
        )

        p_start = clean_text(
            item.get("start_date")
        )

        p_duration = clean_text(
            item.get("duration")
        )

        if not program_name:
            continue

        if not p_day:
            continue

        if not p_start:
            continue

        if not p_duration:
            continue

        try:
            base_date = parse_iso_utc(
                p_day
            )

            start_date = parse_iso_utc(
                p_start
            )

            duration = parse_duration(
                p_duration
            )

            # D-Smart config.js:
            #
            # İlk schedule kaydı referans alınır.
            if day_start is None:
                day_start = start_date

            start = build_dsmart_start(
                base_date=base_date,
                start_date=start_date,
                day_start=day_start,
            )

            stop = (
                start
                + duration
            )

        except Exception as error:
            print(
                "Program hesaplanamadı:",
                program_name,
                error,
            )
            continue

        results.append(
            {
                "channel": channel_id,
                "title": program_name,
                "description": clean_text(
                    item.get("description")
                ),
                "genre": clean_text(
                    item.get("genre")
                ),
                "start": start,
                "stop": stop,
            }
        )

    return results


def fetch_all_pages(day):
    print(
        f"D-Smart günü alınıyor: {day}"
    )

    first = fetch_json(
        day,
        1
    )

    data = first.get(
        "data",
        {}
    )

    total = data.get(
        "total",
        0
    )

    if not total:
        print(
            "Bu gün için kanal yok."
        )
        return []

    pages = (
        total
        + PAGE_LIMIT
        - 1
    ) // PAGE_LIMIT

    print(
        f"Toplam kanal: {total}"
    )

    print(
        f"Toplam sayfa: {pages}"
    )

    all_channels = []

    first_channels = data.get(
        "channels",
        []
    )

    if isinstance(
        first_channels,
        list
    ):
        all_channels.extend(
            first_channels
        )

    for page in range(
        2,
        pages + 1
    ):
        print(
            f"Sayfa {page}/{pages}"
        )

        page_data = fetch_json(
            day,
            page
        )

        page_channels = (
            page_data
            .get("data", {})
            .get("channels", [])
        )

        if isinstance(
            page_channels,
            list
        ):
            all_channels.extend(
                page_channels
            )

    print(
        f"Alınan kanal kaydı: "
        f"{len(all_channels)}"
    )

    return all_channels


def build_xml(
    daily_programs,
    channel_names,
):
    xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv generator-info-name="D-Smart EPG">',
    ]

    # --------------------------------------------------
    # KANALLAR
    # --------------------------------------------------

    used_channels = set()

    for program in daily_programs:
        used_channels.add(
            program["channel"]
        )

    for channel_id in sorted(
        used_channels
    ):
        channel_name = channel_names.get(
            channel_id,
            channel_id
        )

        xml.append(
            f'  <channel '
            f'id="{escape(channel_id)}">'
        )

        xml.append(
            f'    <display-name lang="tr">'
            f'{escape(channel_name)}'
            f'</display-name>'
        )

        xml.append(
            "  </channel>"
        )

    # --------------------------------------------------
    # PROGRAMLAR
    # --------------------------------------------------

    for program in sorted(
        daily_programs,
        key=lambda x: (
            x["channel"],
            x["start"]
        )
    ):
        channel_id = escape(
            program["channel"]
        )

        start = (
            program["start"]
            .astimezone(timezone.utc)
            .strftime(
                "%Y%m%d%H%M%S +0000"
            )
        )

        stop = (
            program["stop"]
            .astimezone(timezone.utc)
            .strftime(
                "%Y%m%d%H%M%S +0000"
            )
        )

        title = escape(
            program["title"]
        )

        xml.append(
            f'  <programme '
            f'start="{start}" '
            f'stop="{stop}" '
            f'channel="{channel_id}">'
        )

        xml.append(
            f'    <title lang="tr">'
            f'{title}'
            f'</title>'
        )

        description = clean_text(
            program.get(
                "description"
            )
        )

        if description:
            xml.append(
                f'    <desc lang="tr">'
                f'{escape(description)}'
                f'</desc>'
            )

        genre = clean_text(
            program.get(
                "genre"
            )
        )

        if genre:
            categories = genre.split("/")

            for category in categories:
                category = clean_text(
                    category
                )

                if category:
                    xml.append(
                        f'    <category lang="tr">'
                        f'{escape(category)}'
                        f'</category>'
                    )

        xml.append(
            "  </programme>"
        )

    xml.append(
        "</tv>"
    )

    return (
        "\n".join(xml)
        + "\n"
    )


def main():
    # D-Smart'ın EPG API'sine UTC tarihleri gönderiyoruz.
    now = datetime.now(
        timezone.utc
    )

    today = now.date()

    tomorrow = (
        today
        + timedelta(days=1)
    )

    days = [
        today,
        tomorrow,
    ]

    all_programs = []
    channel_names = {}

    # --------------------------------------------------
    # BUGÜN + YARIN
    # --------------------------------------------------

    for day in days:

        channels = fetch_all_pages(
            day.isoformat()
        )

        for channel in channels:
            if not isinstance(
                channel,
                dict
            ):
                continue

            channel_id = clean_text(
                channel.get("_id")
            )

            channel_name = clean_text(
                channel.get(
                    "channel_name"
                )
            )

            if channel_id and channel_name:
                channel_names[
                    channel_id
                ] = channel_name

            programs = parse_channel_schedule(
                channel
            )

            all_programs.extend(
                programs
            )

        print(
            f"{day}: "
            f"{len(all_programs)} toplam program"
        )

    if not all_programs:
        raise RuntimeError(
            "Hiç EPG programı alınamadı."
        )

    xml = build_xml(
        all_programs,
        channel_names,
    )

    with open(
        "dsmart.xml",
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:
        file.write(xml)

    print(
        "========================================"
    )

    print(
        "D-SMART EPG BAŞARIYLA OLUŞTURULDU"
    )

    print(
        "Kanal:",
        len(channel_names)
    )

    print(
        "Program:",
        len(all_programs)
    )

    print(
        "========================================"
    )


if __name__ == "__main__":
    main()
