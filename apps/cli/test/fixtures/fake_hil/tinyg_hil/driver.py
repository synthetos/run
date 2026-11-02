"""A stand-in for tinyg_hil.driver: the board is the JSON in $FAKE_HIL_BOARD_FILE (re-read on every connect), or an idle EN board."""
import json
import os

IDLE_EN = {"id": "FAKE", "fb": 450.01, "fv": 0.97, "hp": 1, "hv": 8, "stat": 1, "hold": 0, "vel": 0, "qr": 32}


def board():
    path = os.environ.get("FAKE_HIL_BOARD_FILE")
    if path and os.path.exists(path):
        with open(path) as f:
            return {**IDLE_EN, **json.load(f)}
    return dict(IDLE_EN)


class StatusError(Exception):
    pass


class TinyG:
    def __init__(self, port, baud=115200, *, transcript=None, guard=None):
        self.port = port
        self.state = {}
        self.identity = {}

    def connect(self, timeout=5.0):
        self.state = board()
        self.identity = {k: self.state[k] for k in ("fb", "fv", "hp", "hv", "id")}
        return self.identity

    def get(self, token, *, timeout=2.0):
        value = self.state.get(token)
        if value is None:
            raise StatusError(token)
        return value

    def close(self):
        pass
