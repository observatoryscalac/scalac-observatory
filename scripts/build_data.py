#!/usr/bin/env python3
"""Convert the SCALAC HPC indicators CSV into the data files used by the website.

Usage:
    python3 scripts/build_data.py [path/to/IndicadoresDeUsoHPCLAC2025.csv]

Outputs:
    data/machines.json   – clean, structured data (for reuse / download)
    assets/js/data.js    – same data as a JS global, so index.html also works from file://
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "IndicadoresDeUsoHPCLAC2025.csv"
INST_PATH = ROOT / "data" / "institutions.json"

COUNTRIES = {
    "AR": "Argentina", "BR": "Brazil", "CL": "Chile", "CO": "Colombia", "CR": "Costa Rica",
    "EC": "Ecuador", "MX": "Mexico", "PE": "Peru", "UY": "Uruguay", "BO": "Bolivia",
    "PY": "Paraguay", "VE": "Venezuela", "GT": "Guatemala", "PA": "Panama", "CU": "Cuba",
    "DO": "Dominican Republic", "HN": "Honduras", "SV": "El Salvador", "NI": "Nicaragua",
}

GPU_PATTERN = re.compile(
    r"nvidia|tesla|geforce|quadro|titan|\brtx|\bgtx|radeon|\bmi\d{3}|gpu max|gh200|"
    r"\b[ahvlpkmt]\d{2,4}\b|\bh\d{3}\b|\bl40s?\b|\ba\d{2,4}\b|\bm20\d{2}\b|\bk\d{2}x?m?\b|rtx pro",
    re.I,
)


def flag_to_iso(flag: str) -> str:
    chars = [c for c in flag if 0x1F1E6 <= ord(c) <= 0x1F1FF]
    return "".join(chr(ord(c) - 0x1F1E6 + ord("A")) for c in chars[:2])


def num(v):
    if v is None:
        return None
    s = str(v).strip().replace("%", "")
    if not s:
        return None
    s = s.replace(",", "")
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def parse_map(v):
    """Parse '{A: 3, B C:4}' into [{'name': 'A', 'count': 3}, ...]."""
    s = (v or "").strip().strip("{}").replace("\n", " ")
    out = []
    if not s:
        return out
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            name, _, cnt = part.rpartition(":")
            c = num(cnt)
            out.append({"name": " ".join(name.split()), "count": c if c is not None else 1})
        else:
            out.append({"name": " ".join(part.split()), "count": 1})
    return out


def parse_personnel(v):
    nums = [num(x) or 0 for x in re.findall(r"\d+", v or "")]
    nums += [0] * (3 - len(nums))
    return {"full": nums[0], "half": nums[1], "simple": nums[2]}


def main():
    institutions = json.loads(INST_PATH.read_text(encoding="utf-8"))
    rows = list(csv.reader(CSV_PATH.open(encoding="utf-8-sig", newline="")))
    header = [" ".join(h.split()) for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}

    def col(r, name):
        i = idx[name]
        return r[i].strip() if i < len(r) else ""

    machines, missing = [], set()
    for n, r in enumerate(rows[1:]):
        if not any(c.strip() for c in r):
            continue
        iso = flag_to_iso(col(r, "Country"))
        inst_key = col(r, "Institution").strip()
        geo = institutions.get(inst_key)
        if not geo:
            missing.add(inst_key)
            continue

        short = col(r, "Short Name")
        note = None
        if short and (len(short) > 24 or " " in short):
            note, short = " ".join(short.split()), None

        packages = parse_map(col(r, "CPU&GPU packages"))
        cpus = [p for p in packages if not GPU_PATTERN.search(p["name"]) or "xeon phi" in p["name"].lower()]
        gpus = [p for p in packages if p not in cpus]
        nodes = parse_map(col(r, "Node models and quantity"))

        m = {
            "id": n,
            "name": col(r, "Name"),
            "shortName": short,
            "country": iso,
            "countryName": COUNTRIES.get(iso, iso),
            "institution": inst_key,
            "institutionFull": geo["full"],
            "city": geo["city"],
            "lat": geo["lat"],
            "lon": geo["lon"],
            "usage": {
                "allocated": num(col(r, "Allocated")),
                "down": num(col(r, "Down")),
                "plannedDown": num(col(r, "PLND Down")),
                "idle": num(col(r, "Idle")),
                "planned": num(col(r, "Planned")),
                "reported": num(col(r, "Reported")),
                "pctDown": num(col(r, "%down over total")),
                "pctUse": num(col(r, "%use over avail")),
            },
            "usageNote": note,
            "activeUsers": num(col(r, "Active users")),
            "personnel": parse_personnel(col(r, "Personnel {Full, Half, Simpl}")),
            "dcMaxPowerKW": num(col(r, "Data Center Max Power")),
            "pue": num(col(r, "Data Center PUE")),
            "peakPowerKW": num(col(r, "Cluster Peak Consumption")),
            "nodes": nodes,
            "nodeCount": sum(x["count"] for x in nodes),
            "cpus": cpus,
            "gpus": gpus,
            "cpuCount": sum(x["count"] for x in cpus),
            "gpuCount": sum(x["count"] for x in gpus),
            "rpeakCpuFp64": num(col(r, "Rpeak CPU fp64 TFlop/s")) or 0,
            "rpeakGpuFp16": num(col(r, "Rpeak GPU fp16 TFlop/s")) or 0,
        }
        machines.append(m)

    if missing:
        sys.exit(f"Missing geolocation in data/institutions.json for: {sorted(missing)}")

    payload = {"source": CSV_PATH.name, "year": 2025, "machines": machines}
    (ROOT / "data" / "machines.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    (ROOT / "assets" / "js" / "data.js").write_text(
        "/* Generated by scripts/build_data.py – do not edit by hand. */\nwindow.SCALAC_DATA = "
        + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"OK: {len(machines)} machines, {len({m['country'] for m in machines})} countries")


if __name__ == "__main__":
    main()
