import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("download_looker", Path(__file__).parents[1] / "scripts" / "download_looker.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class LookerDownloadTests(unittest.TestCase):
    def test_protected_json(self):
        self.assertEqual(module.parse_protected_json(")]}'\n{\"ok\":true}"), {"ok": True})

    def test_expand_column_with_null(self):
        column = {"nullIndex": [1], "doubleColumn": {"values": [2.5, 7.0]}}
        self.assertEqual(module.expand_column(column, 3), [2.5, None, 7.0])

    def test_payload_uses_only_published_particulate_fields(self):
        config = {
            "page_id": "p", "datasource_id": "d", "component_id": "c",
            "concepts": {"timestamp": "t", "sensor": "s", "pm1": "a", "pm25": "b", "pm10": "c"}
        }
        payload = module.build_payload("r", config, "America/Santiago")
        fields = payload["dataRequest"][0]["datasetSpec"]["queryFields"]
        self.assertEqual([field["dataTransformation"]["sourceFieldName"] for field in fields],
                         ["_timeStamp_", "_idSensor_", "_pm1_", "_pm25_", "_pm10_"])


if __name__ == "__main__":
    unittest.main()
