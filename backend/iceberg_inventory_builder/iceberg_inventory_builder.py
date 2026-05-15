import inspect
import json
import os
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from typing import Optional, Dict, Any

from pyspark.sql import functions as F
from pyspark.sql.types import (
    StructType,
    StructField,
    LongType,
    StringType,
)
from pyspark.sql.window import Window

from constants import (
    FileType,
    UI_NEWLINE,
    MAIN_BRANCH_ICEBERG_TABLE_NAME,
    MAX_DATA_FILES_TO_COLLECT,
)
from iceberg_inventory_builder.collect_snapshots import CollectSnapshots
from iceberg_inventory_builder.find_search_cutoff import (
    find_search_cutoff,
    SearchCutoff,
)
from icegraph_logger import logger
from spark_connect import open_spark_connect_session
from utils import (
    get_metadata_row_slim_df_from_path,
    get_json_metadata_from_path,
    format_partition,
    format_schemas_to_full_dict,
)

max_data_files_to_collect = int(
    os.getenv("MAX_DATA_FILES_TO_COLLECT", MAX_DATA_FILES_TO_COLLECT)
)


class IcebergInventoryBuilder:
    def __init__(
        self,
        full_table_name: str,
        start_snapshot_id: Optional[int] = None,
        end_snapshot_id: Optional[int] = None,
    ):
        self._spark = open_spark_connect_session()
        self._table_name = full_table_name
        self._start_snapshot_id = start_snapshot_id
        self._end_snapshot_id = end_snapshot_id

        self._spark_tz = self._spark.conf.get("spark.sql.session.timeZone")
        self._errors: Dict[str, str] = {}
        self._warnings: Dict[str, Dict[str, str]] = {}
        self._snapshots_lock = threading.Lock()

        self._search_cutoff: Optional[SearchCutoff] = None

        self._metadata_files = None
        self._main_metadata_file = None
        self._snapshots = None
        self._manifests = None
        self._data_files = None

    def collect(self) -> Dict[str, Any]:
        total_start = time.time()

        self._search_cutoff = find_search_cutoff(
            self._spark,
            self._table_name,
            self._spark_tz,
            self._start_snapshot_id,
            self._end_snapshot_id,
        )

        snapshot_collection = CollectSnapshots(
            self._table_name,
            self._search_cutoff.start_snapshot_cutoff,
            self._search_cutoff.end_snapshot_cutoff,
        ).collect()

        self._snapshots = [asdict(f) for f in snapshot_collection.files]
        self._errors.update(snapshot_collection.errors)
        self._warnings.update(snapshot_collection.warnings)

        # metadata files and manifests are independent once snapshots are ready — run in parallel
        with ThreadPoolExecutor(max_workers=2) as executor:
            meta_future = executor.submit(
                self._timed, "collect_metadata_files", self._collect_metadata_files
            )
            manifests_future = executor.submit(
                self._timed, "collect_manifests", self._collect_manifests
            )
            for name, future in [
                ("collect_metadata_files", meta_future),
                ("collect_manifests", manifests_future),
            ]:
                try:
                    future.result()
                except Exception as e:
                    logger.error(f"[{self._table_name}] {name} failed", exc_info=True)
                    self._errors[name] = str(e)

        logger.info(
            f"[{self._table_name}] total collect took {time.time() - total_start:.2f}s"
        )
        return self._build_result()

    def _timed(self, name: str, fn):
        start = time.time()
        result = fn()
        logger.info(f"[{self._table_name}] {name} took {time.time() - start:.2f}s")
        return result

    def _build_result(self) -> Dict[str, Any]:
        inventory = (
            (self._metadata_files or [])
            + (self._snapshots or [])
            + (self._manifests or [])
            + (self._data_files or [])
        )

        metadata_specs = {"table-name": self._table_name}
        if self._main_metadata_file:
            main_meta_path = self._main_metadata_file["file"]
            try:
                self._main_metadata_file["schemas"] = format_schemas_to_full_dict(
                    self._main_metadata_file.get("schemas", [])
                )
                self._main_metadata_file["table-name"] = self._table_name
                metadata_specs = self._main_metadata_file
            except Exception as e:
                logger.error(
                    f"[{self._table_name}] Metadata specs error for {main_meta_path}",
                    exc_info=True,
                )
                self._errors[main_meta_path] = f"Metadata specs error: {e}"

        return {
            "inventory": inventory,
            "errors": self._errors,
            "warnings": {key: warn["message"] for key, warn in self._warnings.items()},
            "metadata_specs": metadata_specs,
        }

    def _collect_metadata_files(self):
        metadata_df = (
            (
                self._spark.sql(
                    f"SELECT * FROM {self._table_name}.metadata_log_entries"
                )
                .withColumnRenamed("timestamp", "metadata_timestamp")
                .select("file", "metadata_timestamp")
            )
            .filter(
                F.col("metadata_timestamp")
                >= F.lit(str(self._search_cutoff.start_metadata_cutoff))
            )
            .filter(
                F.col("metadata_timestamp")
                <= F.lit(str(self._search_cutoff.end_metadata_cutoff))
            )
        )

        metadata_files = {
            row.file: row.metadata_timestamp for row in metadata_df.collect()
        }

        metadata_files_df = None
        for file, timestamp in metadata_files.items():
            try:
                df = (
                    get_metadata_row_slim_df_from_path(file)
                    .withColumn("metadata_timestamp", F.lit(timestamp))
                    .withColumn("file", F.lit(file))
                )
                metadata_files_df = (
                    df
                    if metadata_files_df is None
                    else metadata_files_df.unionByName(df, allowMissingColumns=True)
                )
            except Exception as e:
                logger.error(
                    f"[{self._table_name}] Metadata file read error for {file}",
                    exc_info=True,
                )
                self._errors[file] = f"Metadata file read error: {e}"

        if metadata_files_df is None:
            return

        rows = metadata_files_df.orderBy(F.desc("metadata_timestamp")).collect()
        n = len(rows)
        with self._snapshots_lock:
            snap_id_to_path = {
                s["snapshot_id"]: s["file_path"] for s in (self._snapshots or [])
            }
        self._metadata_files = []
        for index, row in enumerate(rows):
            is_main_metadata_file = index == 0
            if is_main_metadata_file:
                try:
                    self._main_metadata_file = get_json_metadata_from_path(row.file)
                    self._main_metadata_file["file"] = row.file
                except Exception as e:
                    logger.error(
                        f"[{self._table_name}] Main metadata file read error for {row.file}",
                        exc_info=True,
                    )
                    self._errors[row.file] = f"Main metadata file read error: {e}"

            refs = json.loads(row.refs) if getattr(row, "refs", None) else {}

            current_snap_path = snap_id_to_path.get(row["current-snapshot-id"])
            child_files = [current_snap_path] if current_snap_path else []

            branches = {
                name: attrs["snapshot-id"]
                for name, attrs in refs.items()
                if attrs.get("type") == "branch"
                and name != MAIN_BRANCH_ICEBERG_TABLE_NAME
            }
            snapshot_to_branches = defaultdict(list)
            for branch_name, snap_id in branches.items():
                snapshot_to_branches[snap_id].append(branch_name)

            branch_files = {}
            for snap_id, branch_names in snapshot_to_branches.items():
                snap_path = snap_id_to_path.get(snap_id)
                if snap_path:
                    child_files.append(snap_path)
                    branch_files[snap_path] = ", ".join(branch_names)

            previous_file = rows[index + 1].file if index + 1 < n else None

            self._metadata_files.append(
                {
                    "type": (
                        FileType.MAIN_METADATA.value
                        if is_main_metadata_file
                        else FileType.METADATA.value
                    ),
                    "file_path": row.file,
                    "timestamp": str(row.metadata_timestamp),
                    "snapshot_id": row["current-snapshot-id"],
                    "previous_file": previous_file,
                    "last_sequence_number": (
                        row["last-sequence-number"]
                        if "last-sequence-number" in row
                        else None
                    ),
                    "partition_spec_id": row["default-spec-id"],
                    "current_schema_id": row["current-schema-id"],
                    "sort_order_id": row["default-sort-order-id"],
                    "refs": json.dumps(refs),
                    "properties": row.properties if row.properties else "{}",
                    "pointed_snapshots_files": getattr(
                        row, "pointed_snapshots_files", None
                    ),
                    "pointed_metadata_log_count": row["pointed_metadata_log_count"],
                    "child_files": child_files,
                    "hidden_metadata": {
                        "color_append": 1 - index / (1.5 * n),
                        "branch_files": branch_files,
                    },
                }
            )

    def _collect_manifests(self):
        if not self._snapshots:
            self._manifests = []
            self._data_files = []
            return

        all_manifests_df = self._union_snapshot_manifests_df()
        if all_manifests_df is None:
            self._manifests = []
            self._data_files = []
            return

        manifest_rows = self._timed(
            "collect_manifest_rows",
            lambda: all_manifests_df.join(
                self._search_cutoff.manifests_to_ignore_df, on="path", how="left_anti"
            ).collect(),
        )
        if not manifest_rows:
            self._manifests = []
            self._data_files = []
            return

        self._fill_snapshot_child_files(manifest_rows)

        seen_paths = set()
        deduped_manifest_rows = []
        for m in manifest_rows:
            if m.path not in seen_paths:
                seen_paths.add(m.path)
                deduped_manifest_rows.append(m)

        deduped_manifest_rows = sorted(
            deduped_manifest_rows,
            key=lambda m: m.added_snapshot_timestamp,
            reverse=True,
        )

        data_files = self._timed(
            "collect_data_files",
            lambda: self._collect_data_files(deduped_manifest_rows),
        )
        sorted_data_files = sorted(
            data_files, key=lambda f: f["_added_snapshot_timestamp"], reverse=True
        )

        self._collect_all_relevant_manifests(deduped_manifest_rows, sorted_data_files)
        self._data_files = [
            self._process_data_file(entry) for entry in sorted_data_files
        ]

    def _union_snapshot_manifests_df(self):
        snapshot_schema = StructType(
            [
                StructField("lookup_snap_id", LongType(), False),
                StructField("snapshot_timestamp", StringType(), True),
            ]
        )
        snapshot_to_timestamp = [
            (s["snapshot_id"], s["timestamp"]) for s in self._snapshots
        ]
        snapshot_to_timestamp_df = self._spark.createDataFrame(
            snapshot_to_timestamp, snapshot_schema
        )

        result = None
        for snapshot in self._snapshots:
            snap_id = snapshot["snapshot_id"]
            manifest_list_path = snapshot["file_path"]

            df = (
                self._spark.read.format("avro")
                .load(manifest_list_path)
                .select(
                    F.col("manifest_path").alias("path"),
                    F.col("added_snapshot_id"),
                    F.lit(snap_id).alias("_snap_id"),
                )
            )

            result = (
                df
                if result is None
                else result.unionByName(df, allowMissingColumns=True)
            )

        if result is None:
            return None

        return result.join(
            snapshot_to_timestamp_df,
            F.col("added_snapshot_id") == F.col("lookup_snap_id"),
            "left",
        ).select(
            F.col("path"),
            F.col("added_snapshot_id"),
            F.col("snapshot_timestamp").alias("added_snapshot_timestamp"),
            F.col("_snap_id"),
        )

    def _fill_snapshot_child_files(self, manifest_rows):
        snap_id_to_paths = defaultdict(list)
        seen_per_snap = defaultdict(set)
        for m in manifest_rows:
            if m.path not in seen_per_snap[m._snap_id]:
                snap_id_to_paths[m._snap_id].append(m.path)
                seen_per_snap[m._snap_id].add(m.path)

        with self._snapshots_lock:
            snap_id_to_snapshot = {s["snapshot_id"]: s for s in self._snapshots}
            for snap_id, paths in snap_id_to_paths.items():
                snap = snap_id_to_snapshot.get(snap_id)
                if snap:
                    snap["child_files"].extend(paths)

    def _collect_data_files(self, manifest_rows):
        avro_df = self._aggreate_manifests_to_collect_data_files(manifest_rows)
        if avro_df is None:
            return []

        window = Window.partitionBy("data_file.file_path").orderBy(
            F.desc("_added_snapshot_timestamp")
        )
        avro_df = avro_df.withColumn("_row_num", F.row_number().over(window))

        earliest_df = avro_df.filter(F.col("_row_num") == 1).select(
            F.col("data_file.file_path").alias("_join_key"),
            F.col("data_file"),
            F.col("_added_snapshot_timestamp"),
            F.col("_add_snapshot_id"),
        )

        manifest_entries_df = (
            avro_df.groupBy("data_file.file_path")
            .agg(
                F.collect_list(
                    F.struct(
                        F.col("_manifest_path").alias("path"),
                        F.col("status").alias("status"),
                    )
                ).alias("_manifest_entries")
            )
            .withColumnRenamed("file_path", "_join_key")
        )

        grouped_files_df = (
            manifest_entries_df.join(earliest_df, on="_join_key", how="inner")
            .select(
                "_manifest_entries",
                "_add_snapshot_id",
                "_added_snapshot_timestamp",
                "data_file.file_path",
                "data_file.content",
                "data_file.file_format",
                "data_file.file_size_in_bytes",
                "data_file.record_count",
                "data_file.partition",
                "data_file.sort_order_id",
                "data_file.split_offsets",
                "data_file.key_metadata",
                "data_file.equality_ids",
            )
            .orderBy(F.desc("_added_snapshot_timestamp"))
        )
        grouped_files_limited_df = grouped_files_df.limit(max_data_files_to_collect + 1)

        global_window = Window.orderBy(F.desc("_added_snapshot_timestamp"))
        grouped_files_limited_df = grouped_files_limited_df.withColumn(
            "_row_num", F.row_number().over(global_window)
        )

        cutoff_timestamp = (
            grouped_files_limited_df.filter(
                F.col("_row_num") == max_data_files_to_collect + 1
            )
            .agg(
                F.coalesce(
                    F.first("_added_snapshot_timestamp"), F.lit(0).cast("timestamp")
                ).alias("_cutoff")
            )
            .select("_cutoff")
        )

        result_df = (
            grouped_files_limited_df.join(F.broadcast(cutoff_timestamp), how="cross")
            .filter(F.col("_added_snapshot_timestamp") > F.col("_cutoff"))
            .drop("_row_num", "_cutoff")
        )

        return [row.asDict(recursive=True) for row in result_df.collect()]

    def _aggreate_manifests_to_collect_data_files(self, manifest_rows):
        avro_df = None
        for m_row in manifest_rows:
            try:
                df = (
                    self._spark.read.format("avro")
                    .load(m_row.path)
                    .select("status", "data_file")
                    .withColumn("_manifest_path", F.lit(m_row.path))
                    .withColumn(
                        "_added_snapshot_timestamp",
                        F.lit(m_row.added_snapshot_timestamp),
                    )
                    .withColumn("_add_snapshot_id", F.lit(m_row.added_snapshot_id))
                )
                avro_df = (
                    df
                    if avro_df is None
                    else avro_df.unionByName(df, allowMissingColumns=True)
                )
            except Exception as e:
                logger.error(
                    f"[{self._table_name}] Avro read error for {m_row.path}",
                    exc_info=True,
                )
                self._errors[m_row.path] = f"Avro read error: {e}"

        return avro_df

    def _collect_all_relevant_manifests(self, manifest_rows, avro_entries):
        entries_by_manifest = defaultdict(list)
        for entry in avro_entries:
            for manifest_entry in entry["_manifest_entries"]:
                entries_by_manifest[manifest_entry["path"]].append(
                    {
                        "status": manifest_entry["status"],
                        "file_path": entry["file_path"],
                        "record_count": entry["record_count"],
                        "partition": entry["partition"],
                    }
                )

        manifest_info = {m.path: m for m in manifest_rows}

        self._manifests = []

        for m_path, m_row in manifest_info.items():
            self._process_manifest(m_path, entries_by_manifest[m_path], m_row)

    def _process_manifest(self, m_path, entries, m_row):
        child_data_paths_status = {"existing": [], "deleted": []}
        total_rows = 0
        all_partitions = set()

        if len(entries) == 0 and (
            self._warnings.get("data_files_limit_exceeded") is None
            or self._warnings["data_files_limit_exceeded"]["timestamp"]
            < m_row.added_snapshot_timestamp
        ):
            self._warnings["data_files_limit_exceeded"] = {
                "message": (inspect.cleandoc(f"""
                        Showing partial data! the number of data files exceeds the limit of {max_data_files_to_collect}!

                        Latest snapshot that got cut off (Meaning snapshots above it are included):
                        ID: {m_row.added_snapshot_id}
                        Timestamp: {m_row.added_snapshot_timestamp}

                        The cutoff is applied at the snapshot boundary — all data files belonging to cut-off snapshots are excluded,
                        unless a newer visible snapshot also references them, in which case they are included.
                        Every data file you see is referenced by at least one snapshot that is newer than the cut-off snapshot.
                        """)),
                "timestamp": m_row.added_snapshot_timestamp,
            }

        for entry in entries:
            f_path = entry["file_path"]

            if entry["status"] == 2:
                child_data_paths_status["deleted"].append(f_path)
            else:
                child_data_paths_status["existing"].append(f_path)

            total_rows += entry["record_count"]
            all_partitions.add(format_partition(entry["partition"]))

        self._manifests.append(
            {
                "type": FileType.MANIFEST.value,
                "file_path": m_path,
                "added_snapshot_id": m_row.added_snapshot_id,
                "added_snapshot_timestamp": m_row.added_snapshot_timestamp,
                "partitions": UI_NEWLINE.join(all_partitions),
                "total_rows_in_downstream_files": total_rows,
                "existing_child_files": child_data_paths_status["existing"],
                "deleted_child_files": child_data_paths_status["deleted"],
                "child_files": child_data_paths_status["existing"]
                + child_data_paths_status["deleted"],
            }
        )

    def _process_data_file(self, f):
        if f["content"] == 0:
            f_type = FileType.DATA.value
        elif f["content"] == 1:
            f_type = FileType.POSITION_DELETE.value
        else:
            f_type = FileType.EQUALITY_DELETE.value

        return {
            "type": f_type,
            "file_path": f["file_path"],
            "format": f["file_format"],
            "size_gb": f"{(f['file_size_in_bytes'] / 1024 ** 3):.10f}",
            "row_count": f["record_count"],
            "partition": format_partition(f["partition"]),
            "sort_order_id": f["sort_order_id"],
            "split_offsets": UI_NEWLINE.join(map(str, f["split_offsets"] or [])),
            "key_metadata": f["key_metadata"],
            "equality_ids": f["equality_ids"],
        }
