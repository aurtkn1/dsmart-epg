import json
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape


BASE_URL = "https://www.dsmart.com.tr/api/v1/public/epg/schedules"
PAGE_LIMIT = 10

# D-Smart'ın config.js parser mantığında p.day temel tarih,
# p.start_date ise başlangıç/delta hesabı için kullanılıyor.


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
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.dsmart.com.tr/",
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
        raise ValueError("D-Smart geçerli JSON döndürmedi.")

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


def parse_duration(value):
    text = clean_text(value)

    # Örnek:
    # 2:00:00
    # 1:45:00
    # 17 days, 2:00:00

    if "," in text:
        text = text.split(",", 1)[1].strip()

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


def parse_utc(value):
    value = clean_text(value)

    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    return datetime.fromisoformat(value)


def xmltv_time(dt):
    return dt.astimezone(
        timezone.utc
    ).strftime(
        "%Y%m%d%H%M%S +0000"
    )


def load_channel_map():
    """
    Kanallar için API'deki _id -> channel_name eşleşmesi.
    """

    first = fetch_json(
        datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        1,
    )

    total = first.get("data", {}).get(
        "total", 0
    )

    pages = (
        (total + PAGE_LIMIT - 1)
        // PAGE_LIMIT
        if total
        else 1
    )

    channels = {}

    for page in range(1, pages + 1):
        if page == 1:
            data = first
        else:
            data = fetch_json(
                datetime.now(timezone.utc).strftime(
                    "%Y-%m-%d"
                ),
                page,
            )

        items = data.get("data", {}).get(
            "channels", []
        )

        for channel in items:
            channel_id = clean_text(
                channel.get("_id")
            )

            channel_name = clean_text(
                channel.get("channel_name")
            )

            if channel_id and channel_name:
                channels[channel_id] = channel_name

    return channels


def collect_day(day):
    print(
        f"D-Smart {day} indiriliyor..."
    )

    first = fetch_json(
        day,
        1,
    )

    total = first.get("data", {}).get(
        "total", 0
    )

    pages = (
        (total + PAGE_LIMIT - 1)
        // PAGE_LIMIT
        if total
        else 1
    )

    print(
        f"  Toplam kanal: {total}"
    )

    print(
        f"  Toplam sayfa: {pages}"
    )

    all_channels = []

    for page in range(1, pages + 1):

        if page == 1:
            data = first
        else:
            data = fetch_json(
                day,
                page,
            )

        channels = data.get(
            "data", {}
        ).get(
            "channels", []
        )

        if isinstance(channels, list):
            all_channels.extend(channels)

        print(
            f"  Sayfa {page}/{pages}: "
            f"{len(channels)} kanal"
        )

    return all_channels


def parse_programs(channels):
    programs = []

    for channel in channels:

        channel_id = clean_text(
            channel.get("_id")
        )

        schedule = channel.get(
            "schedule",
            [],
        )

        if not channel_id:
            continue

        if not isinstance(schedule, list):
            continue

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
                base_date = parse_utc(
                    p_day
                )

                start_date = parse_utc(
                    p_start
                )

                duration = parse_duration(
                    p_duration
                )

                # D-Smart config.js:
                #
                # const baseDate = dayjs.utc(p.day)
                # const startDate = dayjs.utc(p.start_date)
                #
                # İlk kayıt başlangıç referansı:
                # dayStart = startDate
                #
                # ofs:
                # base gün + start_date saat farkı
                #
                # Sonraki kayıtlar:
                # delta = startDate - dayStart
                #
                # start = baseDate + ofs + delta
                #
                # Bunu datetime ile birebir uyguluyoruz.

                # Aynı kanal içindeki ilk programı
                # referans kabul etmek yerine item içindeki
                # gerçek p.day ve start_date ilişkisini kullanıyoruz.
                #
                # D-Smart kaynak kodunda ofs:
                #
                # `${p.day.substr(0, 11)}${p.start_date.substr(11)}`
                #
                # şeklinde oluşturuluyor.
                #
                # Bunun Python karşılığı:
                combined = (
                    p_day[:11]
                    + p_start[11:]
                )

                combined_date = parse_utc(
                    combined
                )

                offset = (
                    combined_date
                    - base_date
                )

                # start_date'in p.day içindeki
                # saat farkı ile gerçek gün içi
                # delta'sını hesaplıyoruz.
                start = (
                    base_date
                    + offset
                )

                stop = (
                    start
                    + duration
                )

            except Exception as error:
                print(
                    "Program hesaplama hatası:",
                    program_name,
                    error,
                )
                continue

            programs.append(
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

    return programs


def build_xml(all_programs, channel_map):
    xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv generator-info-name="D-Smart EPG">',
    ]

    # --------------------------------------------------
    # KANALLAR
    # --------------------------------------------------

    used_channels = set()

    for program in all_programs:
        used_channels.add(
            program["channel"]
        )

    for channel_id in sorted(
        used_channels
    ):
        channel_name = channel_map.get(
            channel_id,
            channel_id,
        )

        xml.append(
            f'  <channel id="{escape(channel_id)}">'
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
        all_programs,
        key=lambda x: x["start"],
    ):
        title = escape(
            program["title"]
        )

        start = xmltv_time(
            program["start"]
        )

        stop = xmltv_time(
            program["stop"]
        )

        channel_id = escape(
            program["channel"]
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
            program.get("description")
        )

        if description:
            xml.append(
                f'    <desc lang="tr">'
                f'{escape(description)}'
                f'</desc>'
            )

        genre = clean_text(
            program.get("genre")
        )

        if genre:
            for category in genre.split("/"):
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

    return "\n".join(xml) + "\n"


def main():

    now = datetime.now(
        timezone.utc
    )

    dates = [
        now.date(),
        (now + timedelta(days=1)).date(),
    ]

    channel_map = load_channel_map()

    all_programs = []

    for day in dates:

        channels = collect_day(
            day.isoformat()
        )

        programs = parse_programs(
            channels
        )

        print(
            f"{day}: "
            f"{len(programs)} program"
        )

        all_programs.extend(
            programs
        )

    if not all_programs:
        raise RuntimeError(
            "Hiç EPG programı alınamadı."
        )

    xml = build_xml(
        all_programs,
        channel_map,
    )

    with open(
        "dsmart.xml",
        "w",
        encoding="utf-8",
        newline="\n",
    ) as file:
        file.write(xml)

    print(
        "----------------------------------------"
    )

    print(
        "D-Smart EPG oluşturuldu."
    )

    print(
        "Kanal:",
        len(channel_map)
    )

    print(
        "Program:",
        len(all_programs)
    )

    print(
        "----------------------------------------"
    )


if __name__ == "__main__":
    main()
