from dataclasses import dataclass
from typing import List


@dataclass
class BaseFile:
    file_path: str
    child_files: List[str]
