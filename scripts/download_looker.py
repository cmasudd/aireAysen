#!/usr/bin/env python3
"""Descarga series horarias públicas de Looker Studio y publica CSV mensuales."""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "sources.json"
BASE_URL = "https://datastudio.google.com"
VARIABLES = ("pm1_ugm3", "pm25_ugm3", "pm10_ugm3")


class DownloadError(RuntimeError):
    pass


def parse_protected_json(text: str) -> dict:
    if text.startswith(")]}'"):
        text = text[4:].lstrip("\r\n")
    return json.loads(text)


def discover_app_version(html: str) -> str:
    patterns = (
        r"appVersion\\x22:\\x22(\d+_\d+)",
        r'"appVersion"\s*:\s*"(\d+_\d+)"',
    )
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            return match.group(1)
    raise DownloadError("No fue posible identificar la versión pública de Looker Studio")


def query_field(name: str, source: str, aggregation: int | None = None, *, hourly: bool = False) -> dict:
    transformation: dict = {"sourceFieldName": source}
    if aggregation is not None:
        transformation["aggregation"] = aggregation
    if hourly:
        transformation["transformationConfig"] = {"transformationType": 6}
    return {"name": name, "datasetNs": "d0", "tableNs": "t0", "dataTransformation": transformation}


def build_payload(report_id: str, source: dict, timezone_name: str) -> dict:
    concepts = source["concepts"]
    fields = [
        query_field(concepts["timestamp"], "_timeStamp_", hourly=True),
        query_field(concepts["sensor"], "_idSensor_", 0),
        query_field(concepts["pm1"], "_pm1_", 1),
        query_field(concepts["pm25"], "_pm25_", 1),
        query_field(concepts["pm10"], "_pm10_", 1),
    ]
    return {"dataRequest": [{
        "requestContext": {"reportContext": {
            "reportId": report_id,
            "pageId": source["page_id"],
            "mode": 1,
            "componentId": source["component_id"],
            "displayType": "simple-linechart",
        }, "requestMode": 0},
        "datasetSpec": {
            "dataset": [{"datasourceId": source["datasource_id"], "revisionNumber": 0, "parameterOverrides": []}],
            "queryFields": fields,
            "sortData": [{"sortColumn": fields[0], "sortDir": 0}],
            "includeRowsCount": True,
            "relatedDimensionMask": {"addDisplay": False, "addUniqueId": False, "addLatLong": False},
            "dsFilterOverrides": [], "filters": [], "features": [], "dateRanges": [],
            "contextNsCount": 1, "calculatedField": [], "needGeocoding": False,
            "geoFieldMask": [], "multipleGeocodeFields": [], "timezone": timezone_name,
        },
        "role": "main",
    }]}


def expand_column(column: dict, size: int) -> list:
    nulls = {int(index) for index in column.get("nullIndex", [])}
    payload = next((value for key, value in column.items() if key.endswith("Column") and isinstance(value, dict)), {})
    values = iter(payload.get("values", []))
    result = []
    for index in range(size):
        result.append(None if index in nulls else next(values, None))
    return result


def rows_from_response(payload: dict, environment: str, allowed_ids: set[int]) -> tuple[list[dict], str | None]:
    response = payload.get("dataResponse", [{}])[0]
    if response.get("errorStatus"):
        raise DownloadError(f"Looker devolvió error para {environment}: {response['errorStatus']}")
    subsets = response.get("dataSubset", [])
    table = next((item.get("dataset", {}).get("tableDataset") for item in subsets if item.get("dataset")), None)
    if not table:
        raise DownloadError(f"Looker no devolvió una tabla para {environment}")
    size = int(table.get("size", 0))
    if size < 1 or len(table.get("column", [])) != 5:
        raise DownloadError(f"Tabla inesperada para {environment}: {size} filas")
    columns = [expand_column(column, size) for column in table["column"]]
    rows = []
    for fecha, sensor, pm1, pm25, pm10 in zip(*columns):
        if fecha is None or sensor is None:
            continue
        sensor_id = int(sensor)
        if sensor_id not in allowed_ids:
            raise DownloadError(f"Sensor no documentado en {environment}: {sensor_id}")
        parsed = datetime.fromisoformat(str(fecha))
        values = []
        for value in (pm1, pm25, pm10):
            number = None if value is None else float(value)
            values.append(None if number is not None and (number < 0 or number > 5000) else number)
        rows.append({
            "fecha": parsed.strftime("%Y-%m-%d %H:%M:%S"),
            "sensor_id": sensor_id,
            "ambiente": environment,
            "pm1_ugm3": values[0], "pm25_ugm3": values[1], "pm10_ugm3": values[2],
        })
    timestamp = response.get("dataTimestamp")
    return rows, timestamp


def download_all(config: dict, timeout: int = 180) -> tuple[list[dict], dict]:
    report_id = config["report_id"]
    session = requests.Session()
    entry_page = config["sources"][0]["page_id"]
    report_url = f"{BASE_URL}/reporting/{report_id}/page/{entry_page}"
    html_response = session.get(report_url, timeout=30)
    html_response.raise_for_status()
    app_version = discover_app_version(html_response.text)
    rows, timestamps = [], {}
    for source in config["sources"]:
        response = session.post(
            f"{BASE_URL}/batchedDataV2?appVersion={app_version}",
            json=build_payload(report_id, source, config["timezone"]),
            headers={"Referer": report_url}, timeout=timeout,
        )
        response.raise_for_status()
        source_rows, source_timestamp = rows_from_response(
            parse_protected_json(response.text), source["environment"], set(source["sensor_ids"])
        )
        rows.extend(source_rows)
        timestamps[source["environment"]] = source_timestamp
    if not rows:
        raise DownloadError("La descarga completa no contiene mediciones")
    rows.sort(key=lambda row: (row["sensor_id"], row["fecha"]))
    return rows, {"app_version": app_version, "data_timestamps": timestamps}


def csv_content(rows: list[dict]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=["fecha", "sensor_id", "ambiente", *VARIABLES])
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def write_if_changed(path: Path, content: str) -> bool:
    encoded = content.encode("utf-8")
    if path.exists() and path.read_bytes() == encoded:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True


def publish(rows: list[dict], config: dict, metadata: dict, output_dir: Path) -> dict:
    by_sensor_month: dict[tuple[int, str], list[dict]] = defaultdict(list)
    by_sensor: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        month = row["fecha"][:7]
        by_sensor_month[(row["sensor_id"], month)].append(row)
        by_sensor[row["sensor_id"]].append(row)

    precise = config["precise_site"]
    precise_ids = set(precise["sensor_ids"])
    stations = []
    latest_rows = []
    source_by_id = {sensor_id: source for source in config["sources"] for sensor_id in source["sensor_ids"]}
    for sensor_id in sorted(by_sensor):
        sensor_rows = by_sensor[sensor_id]
        files = []
        for (current_id, month), month_rows in sorted(by_sensor_month.items()):
            if current_id != sensor_id:
                continue
            relative = f"data/sensor-{sensor_id}/{month}.csv"
            write_if_changed(output_dir.parent / relative, csv_content(month_rows))
            files.append(relative)
        last = sensor_rows[-1]
        latest_rows.append(last)
        exact = sensor_id in precise_ids
        station = {
            "sensor_id": sensor_id,
            "name": f"Sensor {sensor_id}",
            "environment": source_by_id[sensor_id]["environment"],
            "location": precise["description"] if exact else "Área de Coyhaique; ubicación exacta no disponible",
            "location_precision": "exacta" if exact else "general",
            "latitude": precise["latitude"] if exact else None,
            "longitude": precise["longitude"] if exact else None,
            "altitude_m": precise["altitude_m"] if exact else None,
            "variables": list(VARIABLES),
            "record_count": len(sensor_rows),
            "first_at": sensor_rows[0]["fecha"], "last_at": last["fecha"], "files": files,
        }
        stations.append(station)
    latest = csv_content(latest_rows)
    write_if_changed(output_dir / "latest.csv", latest)
    manifest = {
        "updated_at": max(row["fecha"] for row in rows),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Looker Studio: data Aysen",
        "source_url": f"https://datastudio.google.com/reporting/{config['report_id']}",
        "variables": {
            "pm1_ugm3": {"label": "MP1", "unit": "µg/m³", "norm": None},
            "pm25_ugm3": {"label": "MP2,5", "unit": "µg/m³", "norm": {"period": "24 h", "limit": 50, "reference": "DS 12/2011 MMA"}},
            "pm10_ugm3": {"label": "MP10", "unit": "µg/m³", "norm": {"period": "24 h", "limit": 130, "reference": "DS 12/2021 MMA, publicado en 2022"}}
        },
        "source_metadata": metadata,
        "stations": stations,
    }
    write_if_changed(output_dir / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=ROOT / "data")
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    rows, metadata = download_all(config, args.timeout)
    manifest = publish(rows, config, metadata, args.output)
    print(f"Descarga lista: {len(rows):,} filas, {len(manifest['stations'])} sensores; última {manifest['updated_at']}")


if __name__ == "__main__":
    main()
