#!/usr/bin/env python3
"""Emit non-empty XLSX rows as JSON Lines using only Python's standard library.

The importer intentionally preserves source cells rather than interpreting
vehicle power. Interpretation happens later, during evidence review.
"""

from __future__ import annotations

import json
import posixpath
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


def column_from_reference(reference: str) -> str:
    return "".join(char for char in reference if char.isalpha())


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    path = "xl/sharedStrings.xml"
    if path not in archive.namelist():
        return []
    root = ET.fromstring(archive.read(path))
    values: list[str] = []
    for item in root.findall(f"{MAIN_NS}si"):
        values.append("".join(node.text or "" for node in item.iter(f"{MAIN_NS}t")))
    return values


def worksheet_paths(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {
        relation.attrib["Id"]: relation.attrib["Target"]
        for relation in rels.findall(f"{PKG_REL_NS}Relationship")
    }
    sheets: list[tuple[str, str]] = []
    for sheet in workbook.findall(f"{MAIN_NS}sheets/{MAIN_NS}sheet"):
        relation_id = sheet.attrib[f"{REL_NS}id"]
        target = targets[relation_id]
        sheets.append((sheet.attrib["name"], posixpath.normpath(posixpath.join("xl", target))))
    return sheets


def cell_value(cell: ET.Element, strings: list[str]) -> str | None:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{MAIN_NS}t"))
    value = cell.find(f"{MAIN_NS}v")
    if value is None or value.text is None:
        return None
    if cell_type == "s":
        index = int(value.text)
        return strings[index] if 0 <= index < len(strings) else value.text
    return value.text


def emit_workbook(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        strings = shared_strings(archive)
        for sheet_name, worksheet_path in worksheet_paths(archive):
            root = ET.fromstring(archive.read(worksheet_path))
            for row in root.findall(f"{MAIN_NS}sheetData/{MAIN_NS}row"):
                cells: dict[str, str] = {}
                for cell in row.findall(f"{MAIN_NS}c"):
                    value = cell_value(cell, strings)
                    if value not in (None, ""):
                        cells[column_from_reference(cell.attrib["r"])] = value
                if cells:
                    print(json.dumps({
                        "sheet": sheet_name,
                        "rowNumber": int(row.attrib["r"]),
                        "cells": cells,
                    }, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract-vehicle-power-workbook.py <workbook.xlsx>")
    source_path = Path(sys.argv[1])
    if not source_path.is_file():
        raise SystemExit(f"Workbook does not exist: {source_path}")
    emit_workbook(source_path)
