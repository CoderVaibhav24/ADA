"""Uttar Pradesh's 75 districts and their LGD district codes.

Source: the LGD district list as published on the India Data Portal
(district-lgd-codes.csv, state code 9), cross-checked against the Census 2011
codes in the same file. Names are LGD's own spelling; ALIASES maps the other
spellings a geocoder or an officer uses.
"""

from __future__ import annotations

import re

__all__ = ["UP_DISTRICTS", "district_lgd_code", "canonical_district"]

UP_DISTRICTS: dict[str, str] = {
    "Agra": "118",
    "Aligarh": "119",
    "Prayagraj": "120",
    "Ambedkar Nagar": "121",
    "Auraiya": "122",
    "Azamgarh": "123",
    "Baghpat": "124",
    "Bahraich": "125",
    "Ballia": "126",
    "Balrampur": "127",
    "Banda": "128",
    "Barabanki": "129",
    "Bareilly": "130",
    "Basti": "131",
    "Bijnor": "132",
    "Budaun": "133",
    "Bulandshahr": "134",
    "Chandauli": "135",
    "Chitrakoot": "136",
    "Deoria": "137",
    "Etah": "138",
    "Etawah": "139",
    "Ayodhya": "140",
    "Farrukhabad": "141",
    "Fatehpur": "142",
    "Firozabad": "143",
    "Gautam Buddha Nagar": "144",
    "Ghaziabad": "145",
    "Ghazipur": "146",
    "Gonda": "147",
    "Gorakhpur": "148",
    "Hamirpur": "149",
    "Hardoi": "150",
    "Jalaun": "151",
    "Jaunpur": "152",
    "Jhansi": "153",
    "Amroha": "154",
    "Kannauj": "155",
    "Kanpur Dehat": "156",
    "Kanpur Nagar": "157",
    "Kaushambi": "158",
    "Kheri": "159",
    "Kushi Nagar": "160",
    "Lalitpur": "161",
    "Lucknow": "162",
    "Hathras": "163",
    "Maharajganj": "164",
    "Mahoba": "165",
    "Mainpuri": "166",
    "Mathura": "167",
    "Mau": "168",
    "Meerut": "169",
    "Mirzapur": "170",
    "Moradabad": "171",
    "Muzaffarnagar": "172",
    "Pilibhit": "173",
    "Pratapgarh": "174",
    "Rae Bareli": "175",
    "Rampur": "176",
    "Saharanpur": "177",
    "Sant Kabeer Nagar": "178",
    "Bhadohi": "179",
    "Shahjahanpur": "180",
    "Shravasti": "181",
    "Siddharth Nagar": "182",
    "Sitapur": "183",
    "Sonbhadra": "184",
    "Sultanpur": "185",
    "Unnao": "186",
    "Varanasi": "187",
    "Kasganj": "633",
    "Amethi": "640",
    "Sambhal": "659",
    "Shamli": "660",
    "Hapur": "661",
}

# Other names for the same district: renamed ones, OSM spellings, old names.
ALIASES: dict[str, str] = {
    "allahabad": "Prayagraj",
    "faizabad": "Ayodhya",
    "jyotiba phule nagar": "Amroha",
    "lakhimpur kheri": "Kheri",
    "lakhimpur": "Kheri",
    "kushinagar": "Kushi Nagar",
    "mahamaya nagar": "Hathras",
    "sant kabir nagar": "Sant Kabeer Nagar",
    "sant ravidas nagar": "Bhadohi",
    "sant ravidas nagar bhadohi": "Bhadohi",
    "bhadohi sant ravidas nagar": "Bhadohi",
    "shrawasti": "Shravasti",
    "mahrajganj": "Maharajganj",
    "raebareli": "Rae Bareli",
    "rae bareilly": "Rae Bareli",
    "badaun": "Budaun",
    "bagpat": "Baghpat",
    "noida": "Gautam Buddha Nagar",
    "gautam budh nagar": "Gautam Buddha Nagar",
    "gautam buddh nagar": "Gautam Buddha Nagar",
    "kanshiram nagar": "Kasganj",
    "chhatrapati shahuji maharaj nagar": "Amethi",
    "bhim nagar": "Sambhal",
    "prabuddh nagar": "Shamli",
    "panchsheel nagar": "Hapur",
    "kaushambhi": "Kaushambi",
    "sonebhadra": "Sonbhadra",
    "chitrakoot dham": "Chitrakoot",
}


def _key(name: str) -> str:
    text = re.sub(r"[^a-z ]", " ", name.lower())
    text = re.sub(r"\bdistrict\b", " ", text)
    return "".join(text.split())


_BY_KEY: dict[str, str] = {_key(name): name for name in UP_DISTRICTS}
_BY_KEY.update({_key(alias): name for alias, name in ALIASES.items()})
# "Kanpur Nagar" and "Kanpur Dehat" stay distinct; a bare "Kanpur" is Kanpur Nagar.
_BY_KEY["kanpur"] = "Kanpur Nagar"


def canonical_district(name: str | None) -> str | None:
    """LGD's spelling of an Uttar Pradesh district, or None when it is not one."""
    if not name:
        return None
    return _BY_KEY.get(_key(name))


def district_lgd_code(name: str | None) -> str | None:
    """The LGD district code, matched case-insensitively and without a "District" suffix."""
    canonical = canonical_district(name)
    return UP_DISTRICTS[canonical] if canonical else None
