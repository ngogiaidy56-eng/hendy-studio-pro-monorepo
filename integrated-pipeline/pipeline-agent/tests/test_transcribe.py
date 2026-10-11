import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parents[1] / "src" / "transcribe.py"
SPEC = importlib.util.spec_from_file_location("hendy_transcribe", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SubtitleTimestampTests(unittest.TestCase):
    def test_standard_timestamp(self):
        self.assertEqual(MODULE.srt_time(65.007), "00:01:05,007")

    def test_rounding_carries(self):
        self.assertEqual(MODULE.srt_time(59.9996), "00:01:00,000")

    def test_negative_timestamps_are_clamped(self):
        self.assertEqual(MODULE.srt_time(-3), "00:00:00,000")


if __name__ == "__main__":
    unittest.main()
