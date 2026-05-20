from iceberg_inventory_builder.collect_manifests import ManifestFileRecord
from pyspark.sql.types import LongType
from pyspark.sql.types import StringType
from pyspark.sql.types import StructField
from pyspark.sql.types import StructType
from typing import List
from iceberg_inventory_builder.extractor import ExtractionResult
import os
from pyspark.sql import Window
from pyspark.sql import functions as F

from iceberg_inventory_builder.extractor import Extractor
from constants import MAX_DATA_FILES_TO_COLLECT

max_data_files_to_collect = int(os.getenv("MAX_DATA_FILES_TO_COLLECT", MAX_DATA_FILES_TO_COLLECT))

DATA_FILE_RECORD_SCHEMA = StructType(
    [
        StructField("status", StringType(), False),
        StructField("data_file", StringType(), False),
        StructField("manifest_path", StringType(), False),
        StructField("added_snapshot_timestamp", StringType(), True),
        StructField("added_snapshot_id", LongType(), True),
    ]
)


class DataFilesAppearencesExtractor(Extractor):
    def __init__(self, table_name: str, manifest_entries: List[ManifestFileRecord]):
        super().__init__(table_name)
        self._manifest_entries = manifest_entries
        self._errors = {}

    def extract_dataframe(self) -> ExtractionResult:
        data_files_df = self._collect_data_files_from_manifests(self._manifest_entries)
        data_files_with_erliest_ts_df = self._match_data_file_to_earliest_snapshot(data_files_df)
        data_files_by_manifests_df = self._group_data_files_by_manifests(data_files_df)
        data_files_with_manifest_entries_df = self._join_data_file_with_manifest_entries(data_files_with_erliest_ts_df, data_files_by_manifests_df)
        data_files_limited_df = self._limit_and_rank_files_by_snapshot_timestamp(data_files_with_manifest_entries_df)

        snapshot_timestamp_cutoff_df = self._find_cutoff_snapshot_timestamp(data_files_limited_df)

        included_data_files_df = self._find_included_data_files(data_files_limited_df, snapshot_timestamp_cutoff_df)

        return [row.asDict(recursive=True) for row in included_data_files_df.collect()]

    def _group_data_files_by_manifests(self, avro_df):
        manifest_entries_df = avro_df.groupBy("data_file.file_path").agg(
            F.collect_list(
                F.struct(
                    F.col("manifest_path").alias("path"),
                    F.col("status").alias("status"),
                )
            ).alias("manifest_entries")
        )
        return manifest_entries_df

    def _match_data_file_to_earliest_snapshot(self, avro_df):
        window = Window.partitionBy("data_file.file_path").orderBy(F.desc("added_snapshot_timestamp"))
        avro_df = avro_df.withColumn("row_num", F.row_number().over(window))

        earliest_df = avro_df.filter(F.col("row_num") == 1).select(
            F.col("data_file.file_path").alias("file_path"),
            F.col("data_file"),
            F.col("added_snapshot_timestamp"),
            F.col("added_snapshot_id"),
        )
        return earliest_df

    def _join_data_file_with_manifest_entries(self, earliest_df, manifest_entries_df):
        return manifest_entries_df.join(earliest_df, on="file_path", how="inner").select(
            "manifest_entries",
            "added_snapshot_id",
            "added_snapshot_timestamp",
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

    def _limit_and_rank_files_by_snapshot_timestamp(self, df):
        df = df.orderBy(F.desc("added_snapshot_timestamp")).limit(max_data_files_to_collect + 1)

        row_num_window = Window.orderBy(F.desc("added_snapshot_timestamp"))
        df = df.withColumn("row_num", F.row_number().over(row_num_window))

        return df

    def _find_cutoff_snapshot_timestamp(self, df):
        return (
            df.filter(F.col("row_num") == max_data_files_to_collect + 1)
            .agg(F.coalesce(F.first("added_snapshot_timestamp"), F.lit(0).cast("timestamp")).alias("snapshot_timestamp_cutoff"))
            .select("snapshot_timestamp_cutoff")
        )

    def _find_included_data_files(self, grouped_files_limited_df, snapshot_timestamp_cutoff_df):
        return (
            grouped_files_limited_df.join(F.broadcast(snapshot_timestamp_cutoff_df), how="cross")
            .filter(F.col("added_snapshot_timestamp") > F.col("snapshot_timestamp_cutoff"))
            .drop("row_num", "snapshot_timestamp_cutoff")
        )

    def _collect_data_files_from_manifests(self, manifest_rows):
        avro_df = None
        for manifest_entry in manifest_rows:
            try:
                df = self._collect_data_files_from_manifest(manifest_entry)

                if avro_df is None:
                    avro_df = df
                else:
                    avro_df = avro_df.unionByName(df, allowMissingColumns=True)

            except Exception as e:
                self._errors[manifest_entry.path] = f"Avro read error: {e}"

        if avro_df is None:
            return self._spark.createDataFrame([], DATA_FILE_RECORD_SCHEMA)

        return avro_df

    def _collect_data_files_from_manifest(self, manifest_entry: ManifestFileRecord):
        return (
            self._spark.read.format("avro")
            .load(manifest_entry.path)
            .select("status", "data_file")
            .withColumn("manifest_path", F.lit(manifest_entry.path))
            .withColumn(
                "added_snapshot_timestamp",
                F.lit(manifest_entry.added_snapshot_timestamp),
            )
            .withColumn("added_snapshot_id", F.lit(manifest_entry.added_snapshot_id))
        )
