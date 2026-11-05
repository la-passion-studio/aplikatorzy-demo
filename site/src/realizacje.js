/**
 * aplikatorzy.pl — realizacje (the gallery)
 *
 * Add a photo: put the file in media/realizacje/ and add one line below.
 *   src    path to the picture
 *   title  what is on it ("BMW M6 — chrom")
 *   car    optional, shown under the title
 *   type   one of the keys in FILTERS (decides which filter shows it)
 *   shape  optional tile shape in the masonry: 'tall' | 'sq' | 'wide' (default is 3:2)
 *   viz    true for a 3D visualisation instead of a real photo
 *   credit optional, the photographer's credit shown under the picture
 */
export const FILTERS = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'chrom', label: 'Chrom' },
  { key: 'mat', label: 'Mat i satyna' },
  { key: 'kolor', label: 'Zmiana koloru' },
  { key: 'ppf', label: 'Folie ochronne' },
  { key: 'grafika', label: 'Grafika' },
  { key: 'carbon', label: 'Carbon i wnętrze' },
  { key: 'felgi', label: 'Felgi' },
];

export const SHOTS = [
  // Autospotter.pl — Nissan Skyline, pełna grafika. Foto: Maciej Kurczalski, 3MFOTO.pl
  { src: 'media/realizacje/autospotter-przod-34.jpg', title: 'Autospotter.pl — grafika na całe auto', car: 'Nissan Skyline', type: 'grafika', credit: 'Foto: Maciej Kurczalski · 3MFOTO.pl' },
  { src: 'media/realizacje/autospotter-bok.jpg', title: 'Autospotter.pl — bok i felgi', car: 'Nissan Skyline', type: 'grafika', credit: 'Foto: Maciej Kurczalski · 3MFOTO.pl' },
  { src: 'media/realizacje/autospotter-oko.jpg', title: 'Autospotter.pl — detal grafiki', car: 'Nissan Skyline', type: 'grafika', credit: 'Foto: Maciej Kurczalski · 3MFOTO.pl', shape: 'tall' },
  { src: 'media/realizacje/autospotter-tyl.jpg', title: 'Autospotter.pl — tył', car: 'Nissan Skyline', type: 'grafika', credit: 'Foto: Maciej Kurczalski · 3MFOTO.pl', shape: 'wide' },
  { src: 'media/realizacje/autospotter-przod.jpg', title: 'Autospotter.pl — przód', car: 'Nissan Skyline', type: 'grafika', credit: 'Foto: Maciej Kurczalski · 3MFOTO.pl' },

  // BMW M3 Black Edition — czarny mat, realizacja Aplikatorzy (zdjęcia z warsztatu)
  { src: 'media/realizacje/m3-be-przod-34.jpg', title: 'BMW M3 Black Edition — czarny mat', car: 'BMW M3 E92', type: 'mat' },
  { src: 'media/realizacje/m3-be-tyl.jpg', title: 'BMW M3 Black Edition — tył', car: 'BMW M3 E92', type: 'mat' },
  { src: 'media/realizacje/m3-be-przod.jpg', title: 'BMW M3 Black Edition — przód', car: 'BMW M3 E92', type: 'mat', shape: 'sq' },
  { src: 'media/realizacje/m3-be-lusterko.jpg', title: 'Czarny mat — detal lusterka', car: 'BMW M3 E92', type: 'mat', shape: 'tall' },

  // BMW M3 — czarny mat. Foto: foto-klatka.pl
  { src: 'media/realizacje/m3-przod-34.jpg', title: 'BMW M3 — czarny mat', car: 'BMW M3 E92', type: 'mat', credit: 'Foto: foto-klatka.pl' },
  { src: 'media/realizacje/m3-przod.jpg', title: 'BMW M3 — przód', car: 'BMW M3 E92', type: 'mat', credit: 'Foto: foto-klatka.pl' },
  { src: 'media/realizacje/m3-tyl.jpg', title: 'BMW M3 — tył ze skrzydłem', car: 'BMW M3 E92', type: 'mat', credit: 'Foto: foto-klatka.pl', shape: 'sq' },

  { src: 'media/realizacje/s63-przod.jpg', title: 'Mercedes S63 AMG — czerń', car: 'Mercedes-Benz S63 AMG', type: 'kolor', shape: 'wide' },

  // placeholder until the real chrome photos arrive: a 3D visualisation of the film
  { src: 'media/wizualizacje/chrome-front.jpg', title: 'Chrom', car: 'Wizualizacja 3D', type: 'chrom', viz: true },
];
