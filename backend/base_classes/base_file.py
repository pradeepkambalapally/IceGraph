from dataclasses import dataclass
from typing import List
from constants import FileType


@dataclass
class BaseFile:
    type: FileType
    file_path: str
    child_files: List[str]


@dataclass
class HiddenFile:
    pass
