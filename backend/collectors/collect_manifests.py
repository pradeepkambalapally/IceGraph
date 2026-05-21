from arrow import Arrow
from dataclasses import dataclass

from base_classes.base_file import BaseFile


@dataclass
class ManifestRecord(BaseFile):
    type: str
    path: str
    added_snapshot_id: int
    added_snapshot_timestamp: Arrow
    partitions: str
    total_rows_in_downstream_files: int
    existing_child_files: list[str]
    deleted_child_files: list[str]
