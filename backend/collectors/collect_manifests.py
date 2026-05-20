from arrow import Arrow
from dataclasses import dataclass

from base_classes.base_file import BaseFile


@dataclass
class ManifestFileRecord(BaseFile):
    path: str
    added_snapshot_id: int
    added_snapshot_timestamp: Arrow
