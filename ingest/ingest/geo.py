"""Geografische Klassifikation von Events nach Region Mainfranken.

Mainfranken ≈ Regierungsbezirk Unterfranken: die Landkreise Würzburg,
Schweinfurt, Aschaffenburg, Bad Kissingen, Rhön-Grabfeld, Haßberge, Kitzingen,
Main-Spessart und Miltenberg samt der kreisfreien Städte. Viele Quellen liefern
überregional (bundes-/bayernweit); ohne diese Eingrenzung landen Events aus
Berlin, Frankfurt, Nürnberg usw. in der Mainfranken-Liste.

`classify_region` ist bewusst konservativ: erkennt es weder eindeutig
Mainfranken noch eindeutig außerhalb, liefert es "unknown" – die Pipeline
schickt solche Events in die manuelle Sichtung statt sie zu verwerfen.
"""
import re
from typing import Literal

Region = Literal["mainfranken", "outside", "unknown"]

# Fünfstellige Postleitzahl als eigenständige Zahl (keine Hausnummer-Fragmente).
_PLZ_RE = re.compile(r"\b(\d{5})\b")

# Untermain (Aschaffenburg/Miltenberg) liegt im PLZ-Bereich 63739–63939.
# Darunter beginnt Hessen (Hanau 63450, Gelnhausen 63571) – nicht Mainfranken.
_UNTERMAIN_MIN = 63739
_UNTERMAIN_MAX = 63939

# Im 97er-Block liegt ab 97877 der Main-Tauber-Kreis (Wertheim, Külsheim,
# Creglingen, Bad Mergentheim) – Baden-Württemberg, nicht Unterfranken.
_TAUBER_BW_MIN = 97877


def _fold(text: str) -> str:
    """Kleinschreibung + Umlaut-Faltung (ä→ae, ö→oe, ü→ue, ß→ss).

    Quellen liefern Ortsnamen mal mit Umlaut ("Würzburg"), mal transliteriert
    ("Wuerzburg"). Beide Seiten des Abgleichs werden gefaltet, damit der Match
    unabhängig von der Schreibweise greift."""
    return (text.lower()
            .replace("ä", "ae").replace("ö", "oe")
            .replace("ü", "ue").replace("ß", "ss"))

# Kernorte Mainfrankens. Bewusst kuratiert statt vollständig: ein verpasster
# Ort fällt auf "unknown" (manuelle Sichtung), kein falscher Treffer.
_MAINFRANKEN_CITIES = [
    "würzburg", "schweinfurt", "aschaffenburg", "kitzingen", "bad kissingen",
    "haßfurt", "hassfurt", "bad neustadt", "lohr", "marktheidenfeld",
    "karlstadt", "gemünden", "ochsenfurt", "volkach", "veitshöchheim",
    "höchberg", "sulzfeld am main", "alzenau", "miltenberg", "obernburg",
    "klingenberg", "elsenfeld", "gerolzhofen", "hammelburg", "mellrichstadt",
    "münnerstadt", "arnstein", "werneck", "dettelbach", "gerbrunn",
    "estenfeld", "rimpar", "rottendorf", "giebelstadt", "marktbreit",
    "iphofen", "goldbach", "hösbach", "kleinostheim",
]

# Häufige Nicht-Mainfranken-Städte (andere Regierungsbezirke / Bundesländer).
# Bewusst OHNE Stadtnamen, die zugleich gängige deutsche Alltagswörter sind
# ("Hof"/Bahnhof, "Essen", "Münster"/Kirchengebäude, "Kiel"): ein harter
# Treffer würde sonst über Freitext ein Mainfranken-Event still verwerfen.
# Solche Orte landen stattdessen auf 'unknown' → manuelle Sichtung.
_OUTSIDE_CITIES = [
    "berlin", "münchen", "munich", "nürnberg", "nuremberg", "fürth",
    "erlangen", "augsburg", "regensburg", "ingolstadt", "bayreuth", "bamberg",
    "coburg", "passau", "landshut", "rosenheim", "kempten",
    "frankfurt", "offenbach", "hanau", "wiesbaden", "darmstadt", "kassel",
    "fulda", "mainz", "stuttgart", "heilbronn", "mannheim", "karlsruhe",
    "freiburg", "ulm", "tübingen", "heidelberg", "köln", "cologne",
    "düsseldorf", "dortmund", "bonn", "duisburg", "aachen",
    "hamburg", "bremen", "hannover", "braunschweig", "leipzig",
    "dresden", "erfurt", "jena", "weimar", "magdeburg", "lübeck",
    "rostock", "saarbrücken", "wuppertal", "bielefeld",
]


def _build_city_re(cities: list[str]) -> re.Pattern:
    # Stadt-Listen ebenfalls falten, damit Umlaut- und ASCII-Schreibweise matchen.
    # Wortgrenzen verhindern Falschtreffer wie "Fürther Straße" → "Fürth".
    alt = "|".join(re.escape(_fold(c)) for c in cities)
    return re.compile(rf"\b(?:{alt})\b")


_MAINFRANKEN_RE = _build_city_re(_MAINFRANKEN_CITIES)
_OUTSIDE_RE = _build_city_re(_OUTSIDE_CITIES)


def _is_mainfranken_plz(plz: str) -> bool:
    n = int(plz)
    if plz.startswith("97"):
        # ab 97877 beginnt der Main-Tauber-Kreis (Baden-Württemberg).
        return n < _TAUBER_BW_MIN
    return _UNTERMAIN_MIN <= n <= _UNTERMAIN_MAX


def classify_region(city: str | None, location_name: str | None) -> Region:
    """Ordnet ein Event anhand von Stadt und Ortsangabe einer Region zu.

    PLZ hat Vorrang (präziseste Angabe): eine erkannte deutsche PLZ entscheidet
    eindeutig. Erst ohne PLZ greift der Abgleich gegen Orts-Listen.
    """
    text = " ".join(p for p in (city, location_name) if p).strip()
    if not text:
        return "unknown"

    plzs = _PLZ_RE.findall(text)
    if plzs:
        if any(_is_mainfranken_plz(p) for p in plzs):
            return "mainfranken"
        # Deutsche PLZ vorhanden, aber keine davon mainfränkisch → außerhalb.
        return "outside"

    folded = _fold(text)
    if _MAINFRANKEN_RE.search(folded):
        return "mainfranken"
    if _OUTSIDE_RE.search(folded):
        return "outside"
    return "unknown"
