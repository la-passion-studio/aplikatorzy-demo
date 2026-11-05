# Aplikatorzy — nowa strona (demo)

Koncepcja nowej strony [aplikatorzy.pl](https://aplikatorzy.pl) od LA PASSION: film 3D sterowany scrollem, konfigurator folii, animowana oferta.

## Jak obejrzeć

Strona to statyczne pliki w `site/`, ale moduły JS i 3D wymagają serwera (nie działa z `file://`).

**Najprościej (Mac):**

```bash
python3 serve.py 8080
```

i otwórz http://localhost:8080

**Albo** dwuklik w `start.command` — dodaje adres `http://aplikatorzy/` do `/etc/hosts` (pyta o hasło) i otwiera stronę. `remove-aplikatorzy.command` cofa wpis w `/etc/hosts`.

## Struktura

- `site/index.html` — strona główna z filmem 3D (three.js + GSAP lokalnie w `site/vendor/`)
- `site/oferta.html`, `realizacje.html`, `szkolenia.html`, `o-nas.html`, `kontakt.html` — podstrony
- `site/src/` — skrypty i `style.css`
- `site/modelr/`, `site/texr/` — model i tekstury auta
- `site/?capture` — tryb nagrywania klatka po klatce (`window.__ddt.frame(...)`), używany do wideo promo

Model 3D: „Lamborghini Revuelto” — Anatolian Studios, CC BY 4.0.
