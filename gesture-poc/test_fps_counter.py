import unittest

from fps_counter import RollingFps


class RollingFpsTest(unittest.TestCase):
    def test_reports_fps_from_elapsed_frame_intervals(self):
        counter = RollingFps(window_size=3)

        counter.record(1.0)
        counter.record(1.1)

        self.assertAlmostEqual(counter.record(1.2), 10.0)


if __name__ == "__main__":
    unittest.main()
