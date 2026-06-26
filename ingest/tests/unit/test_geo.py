from ingest.geo import classify_region


def test_known_mainfranken_city_via_city_field():
    assert classify_region("Würzburg", None) == "mainfranken"


def test_known_mainfranken_city_via_location_name():
    assert classify_region(None, "THWS, Sanderheinrichsleitenweg 20, Würzburg") == "mainfranken"


def test_mainfranken_plz_97_prefix():
    assert classify_region(None, "Irgendwo, 97318 Kitzingen") == "mainfranken"


def test_untermain_plz_is_mainfranken():
    # Aschaffenburg / Miltenberg liegen im PLZ-Bereich 63739–63939
    assert classify_region(None, "DGZ, 63739 Aschaffenburg") == "mainfranken"


def test_outside_city_berlin():
    assert classify_region("Berlin", None) == "outside"


def test_outside_city_frankfurt():
    assert classify_region("Frankfurt am Main", "ATELIER LIHOTZKY") == "outside"


def test_outside_nuernberg_is_mittelfranken():
    assert classify_region("Nürnberg", None) == "outside"


def test_outside_coburg_and_bamberg_oberfranken():
    assert classify_region("Coburg", None) == "outside"
    assert classify_region("Bamberg", "LAGARDE1") == "outside"


def test_plz_takes_precedence_over_misleading_name():
    # location_name nennt "Fürth" (Mittelfranken) mit PLZ 90762 → outside
    assert classify_region(None, "Rudolf-Breitscheid-Straße 25, 90762 Fürth") == "outside"


def test_non_mainfranken_plz_is_outside():
    assert classify_region(None, "Haus des Spiels, Egidienplatz 23, Nürnberg, 90403") == "outside"


def test_hanau_plz_not_treated_as_untermain_mainfranken():
    # Hanau (63450, Hessen) liegt unterhalb des Mainfranken-Untermain-Bereichs
    assert classify_region(None, "Irgendwo, 63450 Hanau") == "outside"


def test_unknown_when_no_geo_signal():
    assert classify_region(None, None) == "unknown"
    assert classify_region(None, "Online via Zoom") == "unknown"


def test_fuerther_strasse_does_not_falsely_match_fuerth_word():
    # "Fürther Straße" in Nürnberg darf nicht über das Wort "Fürth" als
    # Mittelfranken erkannt werden – aber die PLZ/Stadt Nürnberg schon.
    assert classify_region("Nürnberg", "Fürther Str. 111") == "outside"


def test_sulzfeld_am_main_is_mainfranken():
    assert classify_region("Sulzfeld am Main", None) == "mainfranken"


def test_common_german_noun_hof_does_not_trigger_outside():
    # "Hof"/"Bahnhof" sind Alltagswörter, nicht zwingend die Stadt Hof.
    # Sie dürfen kein hartes Verwerfen auslösen (no-data-loss-Garantie).
    assert classify_region(None, "Veranstaltung am Hof 3") == "unknown"
    assert classify_region(None, "Treffpunkt Bahnhof") == "unknown"


def test_common_german_noun_essen_does_not_trigger_outside():
    assert classify_region(None, "Networking beim Essen") == "unknown"


def test_muenster_building_does_not_trigger_outside():
    # "Münster" ist auch ein Kirchengebäude, nicht nur die Stadt.
    assert classify_region(None, "Konzert im Münster") == "unknown"


def test_mainfranken_event_with_common_noun_in_location_is_kept():
    # Ein Würzburg-Event mit "Bahnhof" im Ort bleibt Mainfranken.
    assert classify_region("Würzburg", "Am Bahnhof 1") == "mainfranken"


def test_ascii_transliterated_mainfranken_cities():
    # Feeds liefern Ortsnamen oft ohne Umlaute.
    assert classify_region("Wuerzburg", None) == "mainfranken"
    assert classify_region("Gemuenden", None) == "mainfranken"
    assert classify_region(None, "Hoechberg, Hauptstraße") == "mainfranken"


def test_main_tauber_plz_is_not_mainfranken():
    # 97877 Wertheim u. a. gehören zu Baden-Württemberg (Main-Tauber-Kreis).
    assert classify_region(None, "97877 Wertheim") == "outside"
    assert classify_region(None, "97980 Bad Mergentheim") == "outside"


def test_bad_kissingen_plz_below_tauber_band_stays_mainfranken():
    assert classify_region(None, "97688 Bad Kissingen") == "mainfranken"
