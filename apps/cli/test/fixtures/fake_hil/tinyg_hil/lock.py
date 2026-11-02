"""Same lock semantics as EN-HIL tinyg_hil/lock.py: an flock on /tmp/tinyg-hil-<port name>.lock."""
import fcntl
import json
import os
import pathlib
import time


class BoardBusy(RuntimeError):
    pass


class BoardLock:
    def __init__(self, port):
        self.path = pathlib.Path("/tmp") / f"tinyg-hil-{pathlib.Path(port).name}.lock"
        self.fd = None

    def acquire(self, purpose, wait=0.0):
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o666)
        end = time.monotonic() + wait
        while True:
            try:
                fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= end:
                    holder = self.path.read_text().strip() or "unknown"
                    os.close(self.fd)
                    self.fd = None
                    raise BoardBusy(f"board in use: {holder}") from None
                time.sleep(0.05)
        os.ftruncate(self.fd, 0)
        os.write(self.fd, json.dumps({"pid": os.getpid(), "purpose": purpose}).encode())
        return self

    def release(self):
        if self.fd is not None:
            os.ftruncate(self.fd, 0)
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            self.fd = None
