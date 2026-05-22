from typing import Any, Dict, Iterable

from constants import UI_NEWLINE, UI_SECTION_NEWLINE


def format_node_info(file_info: Dict[str, Any]) -> str:
    formatted_info = file_info["type"].upper()
    formatted_info += UI_SECTION_NEWLINE + UI_SECTION_NEWLINE.join(f"{key}: {_format_element_for_ui(value)}" for key, value in file_info.items())

    return formatted_info


def _format_element_for_ui(element) -> str:
    if isinstance(element, Iterable) and not isinstance(element, str):
        return UI_NEWLINE.join(list(element))

    return str(element)
