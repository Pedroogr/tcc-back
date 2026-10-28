from collections import deque


class RollingFps:
    def __init__(self, window_size):
        self.timestamps = deque(maxlen=window_size)

    def record(self, timestamp):
        self.timestamps.append(timestamp)

        if len(self.timestamps) < 2:
            return 0.0

        elapsed = self.timestamps[-1] - self.timestamps[0]
        if elapsed <= 0:
            return 0.0

        return (len(self.timestamps) - 1) / elapsed
