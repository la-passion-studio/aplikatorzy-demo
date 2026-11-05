#!/bin/bash
# Aplikatorzy — lokalny serwer na tym Macu.
# Po uruchomieniu strona otwiera się pod adresem  http://aplikatorzy/
# Zatrzymanie: Ctrl+C w tym oknie Terminala.

HOST="aplikatorzy"
DIR="$(cd "$(dirname "$0")" && pwd)/site"

if [ ! -f "$DIR/index.html" ]; then
  echo "Nie widzę folderu site/ obok tego skryptu: $DIR"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'pass' >/dev/null 2>&1; then
  echo "Brakuje python3. Zainstaluj narzędzia Apple poleceniem:"
  echo "  xcode-select --install"
  echo "i uruchom ten skrypt jeszcze raz."
  exit 1
fi

# 1) nazwa aplikatorzy -> ten komputer (jednorazowo, wymaga hasła do Maca)
if ! grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]]+$HOST([[:space:]]|$)" /etc/hosts; then
  echo "Dodaję '$HOST' do /etc/hosts — macOS zapyta o hasło do komputera."
  echo "127.0.0.1   $HOST   # aplikatorzy local" | sudo tee -a /etc/hosts >/dev/null
  sudo dscacheutil -flushcache
  sudo killall -HUP mDNSResponder 2>/dev/null || true
fi

# 2) port 80, żeby adres był bez numeru portu
PORT=80
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 80 jest zajęty przez inny program — używam portu 8080."
  PORT=8080
fi
URL="http://$HOST/"
[ "$PORT" != "80" ] && URL="http://$HOST:$PORT/"

echo ""
echo "  Aplikatorzy działa:  $URL"
echo "  Zatrzymanie: Ctrl+C"
echo ""

( sleep 1.5; open "$URL" ) &

SELF="$(cd "$(dirname "$0")" && pwd)"
# tylko ten komputer (127.0.0.1) — z sieci nikt się nie podłączy
python3 "$SELF/serve.py" "$PORT"
if [ $? -eq 13 ]; then
  echo "Port $PORT wymaga uprawnień — uruchamiam z sudo."
  sudo python3 "$SELF/serve.py" "$PORT"
fi
