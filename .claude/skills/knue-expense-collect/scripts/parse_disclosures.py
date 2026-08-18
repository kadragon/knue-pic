#!/usr/bin/env python3
"""Stage 2 — turn the downloaded attachments into dated transaction rows.

Usage:
    python3 parse_disclosures.py --month 2026-07 [--out-dir collector/out]

Reads <out-dir>/<month>/posts.json, writes raw_transactions.json next to it,
and prints a per-sheet accounting so that a sheet silently yielding zero rows
is visible rather than invisible.

Nothing in here decides whether a venue is a restaurant or where it is — that
is stage 3's job. This stage only has to be faithful to the published file.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

# --- column synonyms ---------------------------------------------------------
# Every published sheet uses the same seven columns, but three departments
# rename them, so match on a synonym set instead of a fixed header string.
DATE_COLS = ("사용일자", "집행일자", "일자", "사용일")
AMOUNT_COLS = ("금액", "지출액", "집행액", "사용금액")
VENUE_COLS = ("사용처", "상호", "상호명")
PURPOSE_COLS = ("사용내역", "집행내역", "내역", "내용")
ATTENDEE_COLS = ("참석대상", "참석인원", "참석", "대상")
METHOD_COLS = ("집행방법", "결제방법", "지출방법")
ADDRESS_COLS = ("소재지", "주소")

NON_ROWS = {"", "none", "합계", "계", "소계", "총계", "합 계", "총 계", "-"}
EXCEL_EPOCH = dt.date(1899, 12, 30)  # Excel's day 1 is 1900-01-01, with the 1900 leap bug


def _clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return " ".join(str(value).split()).strip()


def parse_amount(value) -> int | None:
    text = _clean(value)
    if not text:
        return None
    text = re.sub(r"[^\d.\-]", "", text)
    if not text or text in {"-", "."}:
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def parse_date(value, year: int) -> dt.date | None:
    """Normalise the twelve-plus date spellings the departments publish.

    `year` is the target year, used only to complete formats that omit it
    (e.g. "7.13.") — never to override a date the file states.
    """
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if number.is_integer() and 10_000_000 <= number <= 99_999_999:
            value = str(int(number))  # YYYYMMDD stored as a number
        elif 20_000 <= number <= 80_000:
            return EXCEL_EPOCH + dt.timedelta(days=int(number))  # Excel serial
        else:
            return None

    text = _clean(value)
    if not text:
        return None
    text = re.sub(r"\([^)]*\)", " ", text)  # drop the weekday marker
    digits = [int(n) for n in re.findall(r"\d+", text)]

    if len(digits) == 1 and len(str(digits[0])) == 8:
        raw = str(digits[0])
        digits = [int(raw[:4]), int(raw[4:6]), int(raw[6:])]
    if len(digits) == 2:  # "7.13." — the year is implied by the target month
        digits = [year, *digits]
    if len(digits) < 3:
        return None

    y, m, d = digits[0], digits[1], digits[2]
    if y < 100:
        y += 2000
    try:
        return dt.date(y, m, d)
    except ValueError:
        return None


# --- sheet reading -----------------------------------------------------------

def read_sheets(path: str) -> list[tuple[str, list[list]]]:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".xlsx":
        import openpyxl

        # read_only avoids the styles.xml IndexError that at least one
        # department's export triggers in openpyxl's normal reader.
        book = openpyxl.load_workbook(path, data_only=True, read_only=True)
        return [(ws.title, [list(r) for r in ws.iter_rows(values_only=True)])
                for ws in book.worksheets]
    if ext == ".xls":
        import xlrd

        book = xlrd.open_workbook(path)
        return [(ws.name, [[ws.cell_value(r, c) for c in range(ws.ncols)]
                           for r in range(ws.nrows)])
                for ws in book.sheets()]
    raise ValueError(f"unsupported spreadsheet: {path}")


def find_header(rows: list[list], scan: int = 20) -> tuple[int, dict[str, int]] | None:
    """Locate the header row; it sits anywhere from row 2 to row 8 in practice."""
    for index, row in enumerate(rows[:scan]):
        cells = [_clean(c) for c in row]
        mapping: dict[str, int] = {}
        for name, options in (("date", DATE_COLS), ("amount", AMOUNT_COLS),
                              ("venue", VENUE_COLS), ("purpose", PURPOSE_COLS),
                              ("attendees", ATTENDEE_COLS), ("method", METHOD_COLS),
                              ("address", ADDRESS_COLS)):
            for pos, cell in enumerate(cells):
                if cell in options:
                    mapping[name] = pos
                    break
        if "venue" in mapping and "amount" in mapping and "date" in mapping:
            return index, mapping
    return None


def rows_from_sheet(rows: list[list], mapping: dict[str, int], header_row: int,
                    year: int, month: int) -> tuple[list[dict], int, int]:
    out: list[dict] = []
    off_month = 0
    carried = 0
    previous: dt.date | None = None
    for offset, row in enumerate(rows[header_row + 1:], start=header_row + 2):
        def cell(field: str):
            pos = mapping.get(field)
            return row[pos] if pos is not None and pos < len(row) else None

        venue = _clean(cell("venue"))
        if venue.lower() in NON_ROWS:
            continue
        date = parse_date(cell("date"), year)
        amount = parse_amount(cell("amount"))
        if date is None and previous is not None and amount is not None:
            # A blank 사용일자 above a filled venue/amount is a merged cell:
            # one event paid in two tranches. Dropping it loses a real visit.
            date = previous
            carried += 1
        if date is not None:
            previous = date
        if date is None or amount is None:
            continue
        if (date.year, date.month) != (year, month):
            off_month += 1
            continue
        out.append({
            "date": date.isoformat(),
            "amount": amount,
            "venue": venue,
            "purpose": _clean(cell("purpose")),
            "attendees": _clean(cell("attendees")),
            "method": _clean(cell("method")),
            "address": _clean(cell("address")),
            "row": offset,
            "dateCarriedFromPreviousRow": date == previous and not _clean(cell("date")),
        })
    return out, off_month, carried


# --- PDF reading -------------------------------------------------------------

_PDF_ROW = re.compile(
    r"^\s*\d+\s+"                       # 연번
    r"(?P<date>\d{2,4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}\.?)\s+"
    r"(?P<middle>.+?)\s+"               # 사용내역 + 참석대상
    r"(?P<amount>[\d,]{3,})\s+"
    r"(?P<venue>.+?)\s+"
    r"(?P<method>법인카드|개인카드|현금|계좌이체|카드|클린카드)\s*$"
)


def rows_from_pdf(path: str, year: int, month: int) -> tuple[list[dict], list[str]]:
    import pypdf

    reader = pypdf.PdfReader(path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    out: list[dict] = []
    unparsed: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or not line[0].isdigit():
            continue
        hit = _PDF_ROW.match(line)
        if not hit:
            unparsed.append(line)
            continue
        date = parse_date(hit.group("date"), year)
        amount = parse_amount(hit.group("amount"))
        if date is None or amount is None or (date.year, date.month) != (year, month):
            unparsed.append(line)
            continue
        out.append({
            "date": date.isoformat(),
            "amount": amount,
            "venue": _clean(hit.group("venue")),
            "purpose": _clean(hit.group("middle")),
            "attendees": "",
            "method": _clean(hit.group("method")),
            "address": "",
            "row": 0,
        })
    return out, unparsed


# --- driver ------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="target month, YYYY-MM")
    ap.add_argument("--out-dir", default="collector/out")
    args = ap.parse_args()

    if not re.fullmatch(r"\d{4}-\d{2}", args.month):
        print(f"--month must be YYYY-MM, got {args.month!r}", file=sys.stderr)
        return 2
    year, month = (int(x) for x in args.month.split("-"))

    root = os.path.join(args.out_dir, args.month)
    with open(os.path.join(root, "posts.json"), encoding="utf-8") as fh:
        manifest = json.load(fh)

    transactions: list[dict] = []
    report: list[dict] = []

    for post in manifest["posts"]:
        for entry in post["files"]:
            path = os.path.join(root, entry["path"])
            ext = os.path.splitext(path)[1].lower()
            source = {"nttNo": post["nttNo"], "department": post["department"],
                      "file": entry["filename"]}
            if ext == ".pdf":
                try:
                    rows, unparsed = rows_from_pdf(path, year, month)
                except Exception as exc:  # noqa: BLE001 - report, do not abort the run
                    report.append({**source, "sheet": "(pdf)", "status": f"error: {exc}"})
                    continue
                for row in rows:
                    transactions.append({**row, **source, "sheet": "(pdf)"})
                report.append({**source, "sheet": "(pdf)", "rows": len(rows),
                               "unparsedLines": len(unparsed),
                               "status": "ok" if rows else "no rows"})
                continue
            try:
                sheets = read_sheets(path)
            except Exception as exc:  # noqa: BLE001
                report.append({**source, "sheet": "(file)", "status": f"error: {exc}"})
                continue
            for name, rows in sheets:
                header = find_header(rows)
                if header is None:
                    # 상품권 구매 내역 / 수의계약 sheets legitimately land here.
                    report.append({**source, "sheet": name, "rows": 0,
                                   "status": "no 사용처 header — skipped"})
                    continue
                header_row, mapping = header
                parsed, off_month, carried = rows_from_sheet(
                    rows, mapping, header_row, year, month)
                for row in parsed:
                    transactions.append({**row, **source, "sheet": name})
                report.append({**source, "sheet": name, "rows": len(parsed),
                               "offMonthRows": off_month, "carriedDates": carried,
                               "status": "ok" if parsed else "no rows for target month"})

    transactions.sort(key=lambda t: (t["date"], t["department"], t["venue"]))
    payload = {"month": args.month, "transactions": transactions, "sheetReport": report}
    out_path = os.path.join(root, "raw_transactions.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    departments = {t["department"] for t in transactions}
    print(f"{args.month}: {len(transactions)} transactions from {len(departments)} departments"
          f" -> {out_path}")
    for item in report:
        if item.get("rows"):
            continue
        print(f"  {item['department']} / {item['sheet']}: {item['status']}")
    return 0 if transactions else 1


if __name__ == "__main__":
    raise SystemExit(main())
