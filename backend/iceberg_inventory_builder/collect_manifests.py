from arrow import Arrow
from dataclasses import dataclass

from iceberg_inventory_builder.base_file import BaseFile


@dataclass
class ManifestFileRecord(BaseFile):
    path: str
    added_snapshot_id: int
    added_snapshot_timestamp: Arrow
