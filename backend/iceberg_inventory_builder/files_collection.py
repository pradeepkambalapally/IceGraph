from dataclasses import dataclass, field
from typing import List, Dict

from iceberg_inventory_builder.base_file import BaseFile


@dataclass(frozen=True)
class FilesCollection:
    files: List[BaseFile] = field(default_factory=list)
    errors: Dict[str, str] = field(default_factory=dict)
    warnings: Dict[str, str] = field(default_factory=dict)
