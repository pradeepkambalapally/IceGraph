from argparse import FileType
from typing import Dict

import pyspark

from base_classes.collector import Collector
from base_classes.files_collection import FilesCollection
from base_classes.base_file import BaseFile

from collectors.collect_snapshots import SnapshotRecord

from extractors.manifests_appearences_extractor import ManifestAppearencesExtractor

from arrow import Arrow
from dataclasses import dataclass

from utils import timed


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


class CollectManifests(Collector):
    def __init__(
        self,
        full_table_name: str,
        snapshots: list[SnapshotRecord],
        manifests_to_ignore_df: pyspark.sql.DataFrame,
    ):
        super().__init__(full_table_name)
        self._snapshots = snapshots
        self._manifests_to_ignore_df = manifests_to_ignore_df
        self._errors: Dict[str, str] = {}

    @timed
    def collect(self) -> FilesCollection:
        manifest_extraction_result = ManifestAppearencesExtractor(
            self._full_table_name, self._snapshots, self._manifests_to_ignore_df
        ).extract_dataframe()
        self._errors = manifest_extraction_result.errors

        manifests_rows = manifest_extraction_result.df.collect()
        self._manifests = [self._process_manifest_row(manifest_row) for manifest_row in manifests_rows]

        return FilesCollection(files=self._manifests, errors=self._errors)

    def _process_manifest_row(self, manifest_row) -> ManifestRecord:
        manifest_dict = manifest_row.asDict(recursive=True)

        return ManifestRecord(
            type=FileType.MANIFEST.value,
            path=manifest_dict["path"],
            added_snapshot_id=manifest_dict["added_snapshot_id"],
            added_snapshot_timestamp=manifest_dict["added_snapshot_timestamp"],
            partitions="",
            total_rows_in_downstream_files=0,
            existing_child_files=[],
            deleted_child_files=[],
        )
