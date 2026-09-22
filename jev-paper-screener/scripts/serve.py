#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
SKILL_ROOT = ROOT.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from jev_screener.questions import DEFAULT_WEIGHTS, MODEL_ID, normalize_weights
from jev_screener.run import candidates_from_text, score_with_client, screen_papers, write_run

PAGE = SKILL_ROOT / "assets" / "index.html"
RUNS = Path.cwd() / "runs"


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in {"/", "/index.html"}:
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
            return
        if path == "/api/health":
            self._send(
                200,
                json_bytes({"ok": True, "has_key": bool(os.environ.get("TYPESAFE_API_KEY")), "model": MODEL_ID, "weights": DEFAULT_WEIGHTS}),
                "application/json; charset=utf-8",
            )
            return
        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send(400, json_bytes({"error": "invalid JSON"}), "application/json; charset=utf-8")
            return
        if path == "/api/normalize":
            papers, incomplete = candidates_from_text(payload.get("text") or "", filename=payload.get("filename") or "")
            self._send(
                200,
                json_bytes({"papers": [paper.to_dict() for paper in papers], "incomplete": [item.to_dict() for item in incomplete]}),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/screen":
            project = payload.get("project") or {}
            papers, incomplete = candidates_from_text(payload.get("text") or "", filename=payload.get("filename") or "")
            try:
                weights = normalize_weights(payload.get("weights") or DEFAULT_WEIGHTS)
            except ValueError as exc:
                self._send(400, json_bytes({"error": str(exc)}), "application/json; charset=utf-8")
                return
            answers_by_id = payload.get("answers_by_id")
            scorer = None
            if answers_by_id is None:
                if not os.environ.get("TYPESAFE_API_KEY"):
                    self._send(400, json_bytes({"error": "TYPESAFE_API_KEY is missing"}), "application/json; charset=utf-8")
                    return
                try:
                    from typesafe_sdk import TypeSafeClient
                except ImportError:
                    self._send(400, json_bytes({"error": "typesafe-sdk is not installed"}), "application/json; charset=utf-8")
                    return
                client = TypeSafeClient()
                scorer = lambda project, paper: score_with_client(client, project, paper, model=MODEL_ID)
            result = screen_papers(project, papers, incomplete, scorer=scorer, answers_by_id=answers_by_id, weights=weights)
            out_dir = RUNS / result["created_at"]
            write_run(result, out_dir)
            result["out_dir"] = str(out_dir)
            self._send(200, json_bytes(result), "application/json; charset=utf-8")
            return
        self._send(404, json_bytes({"error": "not found"}), "application/json; charset=utf-8")

    def log_message(self, format: str, *args) -> None:
        sys.stderr.write("serve: " + (format % args) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Local Jev paper screener page")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Jev paper screener: http://{args.host}:{args.port}")
    print("Scoring requires TYPESAFE_API_KEY. Import still works without it.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
