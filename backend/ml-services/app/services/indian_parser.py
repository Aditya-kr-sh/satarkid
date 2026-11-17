"""Conservative field parsing from OCR lines; no guesses for missing identity data."""
import re
from datetime import datetime

AADHAAR = re.compile(r"(?<!\d)(?:[2-9]\d{3}[ \-]?\d{4}[ \-]?\d{4}|[Xx*]{4}\s?[Xx*]{4}\s?\d{4})(?!\d)")
PAN = re.compile(r"\b[A-Z]{3}P[A-Z]\d{4}[A-Z]\b", re.I)
DATE = re.compile(r"(?<!\d)(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})(?!\d)")
SKIP_NAME = re.compile(r"government|india|income|department|authority|unique|identification|permanent|account|number|synthetic|test fixture|software|validation|portrait|not a|address|male|female|birth|year|father|enrol|issue|download|www\.|uidai|help|signature", re.I)
FATHER_NAME_LABEL = re.compile(r"Father(?:'s|’s)?\s*Name|पिता\s*(?:का)?\s*नाम", re.I)
NAME_VALUE = re.compile(r"[A-Za-z][A-Za-z .'-]{2,80}")
NAME_LABELS = (r"\b(?:Full\s+)?Name\b", r"नाम")
FATHER_NAME_LABELS = (r"Father(?:'s|’s)?\s*Name", r"पिता\s*(?:का)?\s*नाम")


def parse_lines(lines, requested_type):
    usable = [line for line in lines if line.get("confidence", 0) >= 0.45]
    texts = [line["text"] for line in usable]
    joined = "\n".join(texts)
    fields = {key: None for key in ("full_name", "document_number", "date_of_birth", "date_of_birth_printed",
              "year_of_birth", "gender")}
    pan_hint = bool(re.search(r"income\s*tax|permanent\s*account|\bpan\b", joined, re.I))
    aadhaar_hint = bool(re.search(r"aadhaa?r|uidai|unique\s*identification", joined, re.I))
    pattern = AADHAAR if requested_type == "aadhaar" else PAN
    numbers = []
    for text in texts:
        if re.search(r"\bVID\b|enrol", text, re.I):
            continue
        numbers.extend(re.sub(r"[\s-]", "", m.group()).upper() for m in pattern.finditer(text))
    numbers = list(dict.fromkeys(numbers))
    fields["document_number"] = numbers[0] if len(numbers) == 1 else None
    fields["document_type"] = "pan" if pan_hint else "aadhaar" if aadhaar_hint or (requested_type == "aadhaar" and numbers) else "unknown"
    fields["inconsistent_pages"] = len(numbers) > 1
    fields["is_test_document"] = bool(re.search(r"synthetic|not\s+a\s+government\s+id|test\s+fixture", joined, re.I))

    # Prefer labelled birth lines; PAN also commonly has an unlabelled full date.
    birth = [(i, text) for i, text in enumerate(texts) if len(text) < 80 and re.search(r"D[. /]?O[. /]?B|birth|YoB", text, re.I)]
    candidates = [text + " " + (texts[i + 1] if i + 1 < len(texts) else "") for i, text in birth]
    if not candidates and requested_type == "pan":
        candidates = texts
    for text in candidates:
        match = DATE.search(text)
        if match:
            try:
                parsed = datetime.strptime(re.sub(r"[.\-]", "/", match.group(1)), "%d/%m/%Y").date()
                fields.update(date_of_birth=parsed.isoformat(), date_of_birth_printed=match.group(1).replace(".", "/"), year_of_birth=parsed.year)
                break
            except ValueError:
                pass
        year = re.search(r"\b(?:19|20)\d{2}\b", text)
        if year:
            fields.update(year_of_birth=int(year.group()), date_of_birth_printed=year.group())
            break
    if re.search(r"\bfemale\b", joined, re.I): fields["gender"] = "Female"
    elif re.search(r"\bmale\b", joined, re.I): fields["gender"] = "Male"

    def is_name_value(value):
        return bool(NAME_VALUE.fullmatch(value)) and not SKIP_NAME.search(value) and not PAN.fullmatch(value)

    def nearest_name_below(label_index):
        label = usable[label_index]
        label_box = label.get("box")
        if not label_box or len(label_box) != 4:
            return None
        x1, y1, x2, y2 = label_box
        center_y = (y1 + y2) / 2
        max_distance = max(40, (y2 - y1) * 2.5)
        candidates = []
        for index, candidate in enumerate(usable):
            if index == label_index or candidate.get("page", 0) != label.get("page", 0):
                continue
            box = candidate.get("box")
            text = candidate["text"].strip()
            if not box or len(box) != 4 or not is_name_value(text):
                continue
            left, top, right, bottom = box
            candidate_center_y = (top + bottom) / 2
            overlap = min(x2, right) - max(x1, left)
            distance = candidate_center_y - center_y
            if 0 < distance <= max_distance and overlap > 0:
                candidates.append((distance, -overlap, -candidate.get("confidence", 0), text))
        return min(candidates)[-1] if candidates else None

    def label_value(labels, *, generic_name=False):
        for i, text in enumerate(texts):
            if generic_name and FATHER_NAME_LABEL.search(text):
                continue
            matches = [
                (match.start(), match.group(1).strip())
                for label in labels
                for match in re.finditer(label + r"\s*[:/\-]?\s*(.*)", text, re.I)
            ]
            if not matches:
                continue
            value = max(matches, key=lambda match: match[0])[1]
            if is_name_value(value):
                return value
            if not value:
                nearby_value = nearest_name_below(i)
                if nearby_value:
                    return nearby_value
        return None
    father_name = label_value(FATHER_NAME_LABELS)
    fields["full_name"] = label_value(NAME_LABELS, generic_name=True)
    if not fields["full_name"] and requested_type == "aadhaar":
        # Aadhaar names appear directly above the birth line; PAN names need a label.
        stop = birth[0][0] if birth else len(texts)
        names = [text for i, text in enumerate(texts[:stop]) if usable[i].get("page", 0) == 0
                 and is_name_value(text)
                 and not PAN.fullmatch(text) and text != father_name]
        if names: fields["full_name"] = names[-1] if requested_type == "aadhaar" else names[0]

    return fields
