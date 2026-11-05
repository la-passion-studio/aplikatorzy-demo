"""Aplikatorzy — maly serwer lokalny.

Zwykle `python3 -m http.server` bierze typy plikow z ustawien systemu. Gdy
.js wyjdzie z niewlasciwym typem, przegladarka odmawia uruchomienia modulow
i scena 3D nie startuje. Tutaj typy sa podane wprost, a kazdy blad jest
wypisany w Terminalu.
"""
import functools
import http.server
import os
import sys

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".webm": "video/webm",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return TYPES.get(ext) or super().guess_type(path)

    def end_headers(self):
        # po kazdej zmianie plikow przegladarka ma brac nowa wersje
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        line = fmt % args
        code = str(args[1]) if len(args) > 1 else ""
        if code.startswith(("4", "5")):
            sys.stderr.write(f"  BLAD  {line}\n")
        elif "/src/main.js" in line:
            sys.stderr.write("  ok    strona i skrypty wczytane\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")
    handler = functools.partial(Handler, directory=root)
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    except PermissionError:
        sys.exit(13)
    except OSError as e:
        print(f"Nie moge uruchomic serwera na porcie {port}: {e}")
        sys.exit(1)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSerwer zatrzymany.")


if __name__ == "__main__":
    main()
