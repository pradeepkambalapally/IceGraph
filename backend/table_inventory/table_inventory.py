from base_classes.base_file import BaseFile
from constants import FileType
from dataclasses import dataclass
from constants import DATA_FILES_CUTOFF_WARNING
from icegraph_logger import logger
from concurrent.futures import ThreadPoolExecutor
from collectors.collect_manifests import CollectManifests
from collectors.collect_data_files import CollectDataFiles
from extractors.manifests_appearences_extractor import ManifestAppearencesExtractor
from collectors.collect_metadata import CollectMetadata
from collectors.collect_snapshots import CollectSnapshots
from search_cutoff.find_search_cutoff import find_search_cutoff
from utils import timed
from google.protobuf.any_pb2 import Any
from typing import List
from collectors.collect_data_files import DataFileRecord
from collectors.collect_manifests import ManifestRecord
from collectors.collect_snapshots import SnapshotRecord
from collectors.collect_metadata import MetadataFileRecord
from search_cutoff.find_search_cutoff import SearchCutoff
from typing import Dict
from spark_connect import open_spark_connect_session
from typing import Optional
from constants import MAX_DATA_FILES_TO_COLLECT
import os

max_data_files_to_collect = int(os.getenv("MAX_DATA_FILES_TO_COLLECT", MAX_DATA_FILES_TO_COLLECT))


@dataclass
class TableInventoryResult:
    errors: Dict[str, str]
    warnings: Dict[str, str]
    snapshots: List[SnapshotRecord]
    manifests: List[ManifestRecord]
    data_files: List[DataFileRecord]
    metadata_files: List[MetadataFileRecord]
    current_main_metadata_file: MetadataFileRecord


class TableInventory:
    def __init__(
        self,
        full_table_name: str,
        start_snapshot_id: Optional[int] = None,
        end_snapshot_id: Optional[int] = None,
    ):
        self._table_name = full_table_name
        self._start_snapshot_id = start_snapshot_id
        self._end_snapshot_id = end_snapshot_id

        self._spark = open_spark_connect_session()
        self._spark_tz = self._spark.conf.get("spark.sql.session.timeZone")

        self._errors: Dict[str, str] = {}
        self._warnings: Dict[str, str] = {}

        self._search_cutoff: SearchCutoff = None

        self._metadata_files: List[MetadataFileRecord] = None
        self._snapshots: List[SnapshotRecord] = None
        self._manifests: List[ManifestRecord] = None
        self._data_files: List[DataFileRecord] = None

    @timed
    def build(self):
        self._find_search_cutoff()

        self._collect_and_set_snapshots()
        self._collect_metadata_manifests_and_data_files()

        self._attach_snapshot_files_to_manifest_files()
        self._attach_manifest_files_to_data_files()

        self._warn_if_data_cutoff_happend()

        self._get_current_table_specs()

        return TableInventoryResult(
            errors=self._errors,
            warnings=self._warnings,
            snapshots=self._snapshots,
            manifests=self._manifests,
            data_files=self._data_files,
            metadata_files=self._metadata_files,
            current_main_metadata_file=self.current_main_metadata_file,
        )

    def _find_search_cutoff(self):
        self._search_cutoff = find_search_cutoff(
            self._spark,
            self._table_name,
            self._spark_tz,
            self._start_snapshot_id,
            self._end_snapshot_id,
        )

    def _collect_and_set_snapshots(self):
        snapshot_collection = CollectSnapshots(
            self._table_name,
            self._search_cutoff.start_snapshot_cutoff,
            self._search_cutoff.end_snapshot_cutoff,
        ).collect()

        self._errors.update(snapshot_collection.errors)
        self._warnings.update(snapshot_collection.warnings)

        self._snapshots = snapshot_collection.files

    def _collect_metadata_manifests_and_data_files(self):
        with ThreadPoolExecutor(max_workers=2) as executor:
            metadata_future = executor.submit(self._threaded_collect_metadata_files)
            manifests_and_data_files_future = executor.submit(self._threaded_collect_manifests_and_data_files)

            try:
                metadata_collection = metadata_future.result()

                self._errors.update(metadata_collection.errors)
                self._warnings.update(metadata_collection.warnings)

                self._metadata_files = metadata_collection.files

            except Exception as e:
                logger.error(f"[{self._table_name}] Failed to collect metadata", exc_info=True)
                self._errors["collect_metadata_files"] = str(e)

            try:
                manifests_collection, data_files_collection = manifests_and_data_files_future.result()

                self._errors.update(manifests_collection.errors)
                self._errors.update(data_files_collection.errors)
                self._warnings.update(manifests_collection.warnings)
                self._warnings.update(data_files_collection.warnings)

                self._manifests = manifests_collection.files
                self._data_files = data_files_collection.files

            except Exception as e:
                logger.error(
                    f"[{self._table_name}] Failed to collect manifests or data files",
                    exc_info=True,
                )
                self._errors["collect_manifests_and_data_files"] = str(e)

    def _threaded_collect_metadata_files(self):
        return CollectMetadata(
            self._table_name,
            self._search_cutoff.start_metadata_cutoff,
            self._search_cutoff.end_metadata_cutoff,
            self._snapshots,
        ).collect()

    def _threaded_collect_manifests_and_data_files(self):
        manifests_collection = CollectManifests(
            self._table_name,
            self._snapshots,
            self._search_cutoff.manifests_to_ignore_df,
        ).collect()

        data_files_collection = CollectDataFiles(
            self._table_name,
            manifests_collection.files,
        ).collect()

        return manifests_collection, data_files_collection

    def _attach_snapshot_files_to_manifest_files(self):
        if not self._snapshots or not self._manifests:
            return

        snapshot_id_to_snapshot_file_map = {snapshot.snapshot_id: snapshot for snapshot in self._snapshots}

        for manifest in self._manifests:
            for snapshot_id in manifest.hidden_manifest_data.pointing_snapshots:

                snapshot = snapshot_id_to_snapshot_file_map.get(snapshot_id)
                if not snapshot:
                    self._errors[f"Linking {snapshot_id} -> {manifest.file_path}"] = "Snapshot not found"

                else:
                    snapshot.child_files.append(manifest.file_path)

    def _attach_manifest_files_to_data_files(self):
        if not self._manifests or not self._data_files:
            return

        manifest_file_path_to_manifest_map = {manifest.file_path: manifest for manifest in self._manifests}

        for data_file in self._data_files:
            for pointing_manifest in data_file.hidden_data_file_metadata.pointing_manifests:
                manifest_file_path, manifest_pointing_status = (
                    pointing_manifest["path"],
                    pointing_manifest["status"],
                )

                manifest = manifest_file_path_to_manifest_map.get(manifest_file_path)
                if not manifest:
                    self._errors[f"Linking {manifest_file_path} -> {data_file.file_path}"] = "Manifest not found"

                else:
                    manifest.partitions.add(data_file.partition)
                    manifest.total_rows_in_downstream_files += data_file.row_count

                    manifest.child_files.append(data_file.file_path)
                    if manifest_pointing_status == 2:
                        manifest.deleted_child_files.append(data_file.file_path)
                    else:
                        manifest.existing_child_files.append(data_file.file_path)

    def _warn_if_data_cutoff_happend(self):
        if not self._manifests:
            return

        max_manifest_added_snapshot_timestamp = None
        max_manifest_added_snapshot_id = None

        for manifest in self._manifests:
            if len(manifest.existing_child_files) == 0:
                if max_manifest_added_snapshot_timestamp is None or max_manifest_added_snapshot_timestamp < manifest.added_snapshot_timestamp:
                    max_manifest_added_snapshot_timestamp = manifest.added_snapshot_timestamp
                    max_manifest_added_snapshot_id = manifest.added_snapshot_id

        if max_manifest_added_snapshot_timestamp is not None:
            self._warnings["data_files_cutoff"] = DATA_FILES_CUTOFF_WARNING.format(
                max_data_files_to_collect=max_data_files_to_collect,
                added_snapshot_id=max_manifest_added_snapshot_id,
                added_snapshot_timestamp=max_manifest_added_snapshot_timestamp,
            )

    def _get_current_table_specs(self):
        self.current_main_metadata_file = next(
            metadata_file for metadata_file in self._metadata_files if metadata_file.type == FileType.MAIN_METADATA
        )
