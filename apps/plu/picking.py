"""
Reads a photo of a picking list and names the PLU for each line on it.

Two jobs, kept apart so each can be tested on its own:

* `read_lines` — the words on the photo, one entry per printed line, each
  with how sure Tesseract was of it. The photo is straightened, cleaned
  and enlarged first; block and automatic layouts are compared. If the
  read is doubtful, a locally thresholded copy is tried too, since
  a phone photo under shop lights is rarely lit evenly.

* `Catalogue.match` — the PLU a line means. Words are weighted by how
  rare they are across the list (SCOTCH tells you more than BEEF, which
  is on half the list), a misread word still counts when it is within a
  letter or two of a real one (CH0PS is CHOPS), and a PLU code printed on
  the sheet is trusted only when the product words agree. Every match carries a score from 0 to 1
  and the runners-up, so the page can say how sure it is and offer the
  others rather than quietly writing down the wrong cut.
"""

import difflib
import io
import math
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field

from PIL import Image, ImageChops, ImageFilter, ImageOps

# What a photo is scaled up to before Tesseract reads small print reliably.
OCR_WIDTH = 1800

# Mean word confidence (0–100) under which the first read is doubted and
# a thresholded copy is tried as well.
DOUBTFUL = 65

# Below this, a line's match is not offered as the answer, only as a guess.
SURE = 0.72
LIKELY = 0.42
FLOOR = 0.18

# Words that appear on picking lists but never name a cut.
NOISE = {
    "KG", "KGS", "GRAM", "GRAMS", "PCS", "PKT", "PKTS", "PACKS", "QTY", "EACH",
    "THE", "AND", "FOR", "PLEASE", "TOTAL", "ORDER", "ORDERS", "DATE", "ITEM",
    "ITEMS", "LIST", "NAME", "PICK", "PICKING", "CUSTOMER", "PHONE", "NOTE",
    "NOTES", "THANKS", "THANK", "YOU", "PAGE", "SHOP", "DELIVERY", "PICKUP",
    "PLU", "CODE", "GMS", "GM", "PACK", "UNIT", "UNITS",
}

# Keep these narrow: preparation and species are meaningful product differences.
ALIASES = {
    "CHKN": "CHICKEN", "CKN": "CHICKEN", "BNLS": "BONELESS",
    "CHOPS": "CHOP", "STEAKS": "STEAK", "FILLETS": "FILLET",
    "SAUSAGES": "SAUSAGE", "RIBS": "RIB", "THIGHS": "THIGH",
    "BREASTS": "BREAST", "LEGS": "LEG", "WINGS": "WING",
}
SPECIES = frozenset({"BEEF", "LAMB", "PORK", "CHICKEN", "TURKEY", "VEAL", "GOAT", "FISH"})
PREPARATIONS = (frozenset({"BONELESS", "BONEIN"}), frozenset({"SKINLESS", "SKINON"}))


class Unreadable(Exception):
    """The photo could not be read — the message is for the user."""


def product_name(item):
    """Keep variant details visible when several PLUs share a title."""
    title, description = item.title.strip(), item.description.strip()
    if title and description and title.casefold() != description.casefold():
        return f"{title} — {description}"
    return title or description


@dataclass
class Line:
    text: str
    confidence: float  # 0–100, Tesseract's mean over the words


@dataclass
class Match:
    item: object = None  # PluItem or None
    score: float = 0.0
    by_code: bool = False
    alternatives: list = field(default_factory=list)  # [(PluItem, score)]

    @property
    def sureness(self):
        """One word for the page: sure, likely, unsure — or none."""
        if self.item is None:
            return "none"
        if self.score >= SURE:
            return "sure"
        if self.score >= LIKELY:
            return "likely"
        return "unsure"


# ---- reading the photo ------------------------------------------------------


def open_photo(uploaded):
    try:
        image = Image.open(uploaded)
        image.load()
    except Exception:
        raise Unreadable("That file isn't a photo we can open. Try a JPEG, PNG or HEIC.")
    return image


def prepare(image):
    """Straight, grey, evened out and big enough to read."""
    import pytesseract

    image = ImageOps.exif_transpose(image).convert("L")
    try:
        osd = pytesseract.image_to_osd(image, timeout=10)
        angle = int(re.search(r"Rotate:\s*(\d+)", osd).group(1))
        conf = float(re.search(r"Orientation confidence:\s*([\d.]+)", osd).group(1))
        # A low-confidence reading is a coin flip that can turn a straight
        # page sideways, so only a sure one is acted on.
        if angle and conf >= 2.0:
            image = image.rotate(-angle, expand=True, fillcolor=255)
    except Exception:
        pass
    image = ImageOps.autocontrast(image, cutoff=1)
    # Bound OCR work on high-resolution camera images without shrinking fine
    # print on ordinary uploads. Invert dark labels before reading them.
    image.thumbnail((3200, 4200), Image.Resampling.LANCZOS)
    if image.resize((1, 1)).getpixel((0, 0)) < 100:
        image = ImageOps.invert(image)
    if image.width < OCR_WIDTH:
        scale = min(OCR_WIDTH / image.width, 4200 / image.height)
        image = image.resize((int(image.width * scale), int(image.height * scale)), Image.LANCZOS)
    return image.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=3))


def threshold(image, radius=25, offset=12):
    """
    Black ink on white, decided patch by patch rather than for the whole
    page, so a shadow across half the sheet doesn't swallow the words in
    it. Pure Pillow: each pixel against the blurred mean around it.
    """
    mean = image.filter(ImageFilter.BoxBlur(radius))
    # (pixel − mean) + 128: ink is darker than its surroundings.
    diff = ImageChops.subtract(image, mean, scale=1.0, offset=128)
    return diff.point(lambda v: 255 if v > 128 - offset else 0)


def _lines_from_data(data):
    """Tesseract's word table folded into lines, with a mean confidence."""
    rows = defaultdict(list)
    for i, word in enumerate(data["text"]):
        word = (word or "").strip()
        if not word:
            continue
        conf = float(data["conf"][i])
        if conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        rows[key].append((word, conf))
    lines = []
    for key in sorted(rows):
        words = rows[key]
        text = " ".join(w for w, _ in words)
        lines.append(Line(text, sum(c for _, c in words) / len(words)))
    return lines


def _ocr(image, psm=6):
    import pytesseract

    data = pytesseract.image_to_data(
        image, config=f"--psm {psm}", output_type=pytesseract.Output.DICT, timeout=15,
    )
    return _lines_from_data(data)


def _quality(lines):
    """How good a read was: mean confidence, weighted by how much it read."""
    if not lines:
        return 0.0
    letters = sum(len(re.sub(r"[^A-Za-z0-9]", "", line.text)) for line in lines)
    conf = sum(line.confidence for line in lines) / len(lines)
    return conf * min(letters / 40, 1.0)


def _read_quality(lines):
    """Prefer a complete read over a confident read of only a heading."""
    letters = sum(len(re.sub(r"[^A-Za-z0-9]", "", line.text)) for line in lines)
    return _quality(lines) * math.log1p(letters)


def read_lines(uploaded):
    """
    The lines on a photo of a list, best read first.

    Raises Unreadable when there is nothing to be had.
    """
    image = prepare(open_photo(uploaded))
    reads = []
    # A list is not always one rectangular block: automatic layout recovers
    # rows missed by the block reader. Never merge passes and duplicate orders.
    for psm in (6, 3):
        try:
            reads.append(_ocr(image, psm=psm))
        except Exception:
            continue
    lines = max(reads, key=_read_quality, default=[])
    if _quality(lines) < DOUBTFUL:
        try:
            reads.append(_ocr(threshold(image), psm=6))
            lines = max(reads, key=_read_quality)
        except Exception:
            pass
    if not reads:
        raise Unreadable("That photo couldn't be read. Try a clearer, straighter one.")
    lines = [line for line in lines if len(line.text.strip()) >= 3]
    if not lines:
        raise Unreadable("No words could be made out. Try more light, and the page filling the frame.")
    return lines


# ---- matching the words -----------------------------------------------------


# Digits Tesseract puts in the middle of words, and the letters they were.
LOOKALIKE = str.maketrans("0158", "OISB")


def tokens(text):
    """
    The words of a line that could name a cut, upper-cased and deduped.

    A digit inside a word is a misread letter — CH0PS, M1NCE — and is put
    back before the word is judged; a number on its own is left to codes().
    """
    out = []
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    text = re.sub(r"\bB\s*/\s*(?:LESS|L)\b", "BONELESS", text)
    text = re.sub(r"\bB\s*/\s*IN\b|\bBONE[\s-]+IN\b", "BONEIN", text)
    text = re.sub(r"\bSKIN[\s-]+ON\b", "SKINON", text)
    # Punctuation separates words; BEEF-MINCE must not become BEEFMINCE.
    for raw in re.findall(r"[A-Z0-9]+", text):
        letters = len(re.findall(r"[A-Z]", raw))
        # No letters, or more digits than letters: a number, or a quantity
        # with its unit stuck on ("500G", "2KG", "3X").
        if not letters or letters <= len(re.findall(r"\d", raw)):
            continue
        if re.match(r"^\d+(KG|KGS|G|GM|GMS|X|EA|PC|PCS|PKT)$", raw):
            continue
        word = re.sub(r"[^A-Z]", "", raw.translate(LOOKALIKE))
        word = ALIASES.get(word, word)
        if len(word) < 3 or word in NOISE or word in out:
            continue
        out.append(word)
    return out[:40]


def codes(text):
    """
    Numbers on a line that could be PLU codes, as (code, labelled).

    Weights, counts and the parts of a date are left out — "2kg", "500g",
    "3 x", "12/09/2026" — and a code
    is "labelled" when the sheet calls it one ("PLU 7012", "#7012"), which
    is what lets a short number on a line of its own be trusted as a code
    rather than read as a quantity.
    """
    found = []
    for m in re.finditer(
        r"(?<![\w./:-])(?:(?P<label>plu|code|#)\s*:?\s*)?(?P<n>\d{1,10})(?![\w./:-]|\s*(?:kg|kgs|g|gm|gms|x|ea|each|pc|pcs|pkt|pack|packs)\b)",
        text, re.I,
    ):
        if not m.group("label") and re.search(r"\b(?:qty\s*:?|x)\s*$", text[:m.start()], re.I):
            continue
        found.append((int(m.group("n")), bool(m.group("label"))))
    return found


class Catalogue:
    """The PLU list, indexed for matching: built once per photo."""

    def __init__(self, items):
        self.items = list(items)
        self.by_code = {item.plu_no: item for item in self.items}
        self.words = [set(tokens(f"{item.title} {item.description}")) for item in self.items]
        seen = defaultdict(int)
        for words in self.words:
            for word in words:
                seen[word] += 1
        n = max(len(self.items), 1)
        # Rare words say more: log(N / df), floored so a word on every
        # row still counts for something.
        self.idf = {w: max(math.log(n / df), 0.15) for w, df in seen.items()}
        self.vocab = sorted(self.idf)
        # What a word the list has never heard of weighs: as much as a
        # typical one, so a line half made of them can't score as sure.
        weights = sorted(self.idf.values())
        self.unknown_weight = weights[len(weights) // 2] if weights else 1.0
        self._fuzzy = {}

    def known(self, word):
        """The catalogue word this one is, allowing for a misread letter."""
        if word in self.idf:
            return word
        if word in self._fuzzy:
            return self._fuzzy[word]
        cutoff = 0.8 if len(word) >= 5 else 0.86
        close = difflib.get_close_matches(word, self.vocab, n=2, cutoff=cutoff)
        # Do not silently turn a short OCR word into either of two equally
        # plausible catalogue words. The remaining words can resolve the item.
        if len(close) == 2 and abs(
            difflib.SequenceMatcher(None, word, close[0]).ratio()
            - difflib.SequenceMatcher(None, word, close[1]).ratio()
        ) < 0.04:
            close = []
        self._fuzzy[word] = close[0] if close else None
        return self._fuzzy[word]

    def match(self, text, keep=3):
        """
        What a line means: the best item, its score, and the runners-up.

        Score is two coverages blended — how much of the line's weight the
        item explains (so a line about lamb chops isn't matched to a
        sausage), and how much of the item's weight the line explains (so
        the tighter description wins over one that merely contains it).
        """
        raw = tokens(text)
        mapped = [(t, self.known(t)) for t in raw]
        line_words = {w for _, w in mapped if w}
        evidence = {}
        for original, word in mapped:
            if word:
                similarity = 1.0 if original == word else difflib.SequenceMatcher(None, original, word).ratio() * 0.9
                evidence[word] = max(evidence.get(word, 0), similarity)
        line_weight = (
            sum(self.idf[w] for w in line_words)
            + self.unknown_weight * (len(raw) - len(line_words))
        )
        scored = []
        if line_words:
            wanted = set(line_words)
            for item, words in zip(self.items, self.words):
                shared = wanted & words
                if not shared:
                    continue
                hit = sum(self.idf[w] * evidence[w] for w in shared)
                item_weight = sum(self.idf[w] for w in words) or 1
                score = 0.65 * (hit / line_weight) + 0.35 * (hit / item_weight)
                # One word can't be sure of a cut named by three: "lamb"
                # alone is likely a lamb item, never surely this one.
                if len(shared) == 1 and len(words) > 1:
                    score = min(score, LIKELY + 0.2)
                # An exact meat/preparation contradiction outweighs shared
                # words such as FILLET. Unknown words still lower coverage.
                if wanted & SPECIES and words & SPECIES and not wanted & words & SPECIES:
                    score *= 0.2
                for group in PREPARATIONS:
                    if wanted & group and words & group and not wanted & words & group:
                        score *= 0.2
                scored.append((score, item))
        scored.sort(key=lambda pair: (-pair[0], len(pair[1].description), pair[1].plu_no))

        # A code printed on the sheet: the answer, when the words don't
        # disagree with it. With no words at all, the code is all there is.
        by_code = None
        for code, labelled in codes(text):
            item = self.by_code.get(code)
            if item is None:
                continue
            if raw:
                candidate_score = next((score for score, candidate in scored if candidate is item), 0)
                agree = bool(scored) and candidate_score >= LIKELY and candidate_score >= scored[0][0] - 0.08
                agree = agree and (labelled or code >= 100)
            else:
                # A number alone: a code if the sheet says so or it is long
                # enough not to be a count of something.
                agree = labelled or code >= 100
            if agree:
                by_code = item
                break

        result = Match()
        if by_code is not None:
            result.item, result.score, result.by_code = by_code, 0.96, True
            result.alternatives = self._others(scored, by_code, keep)
        elif scored and scored[0][0] >= FLOOR:
            result.item, result.score = scored[0][1], round(min(scored[0][0], 1.0), 3)
            if any(word is None for _, word in mapped):
                result.score = min(result.score, SURE - 0.01)
                if len(line_words) == 1:
                    result.score = min(result.score, LIKELY - 0.01)
            if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.08:
                result.score = min(result.score, SURE - 0.01)
            result.alternatives = self._others(scored, result.item, keep)
        else:
            result.alternatives = self._others(scored, None, keep)
        return result

    @staticmethod
    def _others(scored, chosen, keep):
        """
        Different PLUs can share a name but differ in size or preparation.
        Keep those choices and deduplicate only repeated product codes.
        """
        seen = {chosen.plu_no} if chosen is not None else set()
        out = []
        for score, item in scored:
            if score < FLOOR:
                continue
            if item is chosen or item.plu_no in seen:
                continue
            seen.add(item.plu_no)
            out.append((item, round(score, 3)))
            if len(out) == keep:
                break
        return out


def match_lines(lines, items):
    """Every line matched: [(Line, Match)], the unreadable ones dropped."""
    catalogue = Catalogue(items)
    out = []
    for line in lines:
        if not tokens(line.text) and not codes(line.text):
            continue
        match = catalogue.match(line.text)
        # A confident string match does not repair an uncertain OCR reading.
        if line.confidence < 45 and match.item is not None:
            match.score = min(match.score, LIKELY - 0.01)
            match.by_code = False
        out.append((line, match))
    return out
