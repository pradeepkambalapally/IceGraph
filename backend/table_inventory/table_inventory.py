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

        print("\n\n\n")
        print(self._snapshots)
        print(self._manifests)
        print("\n\n\n")

        self._attach_snapshot_files_to_manifest_files()
        self._attach_manifest_files_to_data_files()

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
        pass

    def _attach_manifest_files_to_data_files(self):
        pass
