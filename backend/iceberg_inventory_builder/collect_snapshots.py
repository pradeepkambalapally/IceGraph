import os
from dataclasses import dataclass
from typing import Optional, Dict, List

import pyspark.sql
from arrow import Arrow
from pyspark.sql import functions as F

from constants import (
    FileType,
    UI_NEWLINE,
    MAX_SNAPSHOTS_TO_COMPUTE,
)
from iceberg_inventory_builder.base_file import BaseFile
from iceberg_inventory_builder.collector import Collector
from iceberg_inventory_builder.files_collection import FilesCollection
from icegraph_logger import logger
from utils import timed

max_snapshots_to_compute = int(
    os.getenv("MAX_SNAPSHOTS_TO_COMPUTE", MAX_SNAPSHOTS_TO_COMPUTE)
)


@dataclass
class SnapshotRecord(BaseFile):
    type: str
    timestamp: str
    snapshot_id: int
    parent_id: Optional[int]
    operation: Optional[str]
    summary: str


class CollectSnapshots(Collector):
    def __init__(
        self,
        full_table_name: str,
        start_snapshot_cutoff: Arrow,
        end_snapshot_cutoff: Arrow,
    ):
        super().__init__(full_table_name)

        self._start_snapshot_cutoff = start_snapshot_cutoff
        self._end_snapshot_cutoff = end_snapshot_cutoff

        self._snapshots: List[SnapshotRecord] = []
        self._errors: Dict[str, str] = {}

    @timed
    def collect(self) -> FilesCollection:
        try:
            snapshots_df = self._query_snapshots_df()
            self._validate_snapshot_count(snapshots_df)
            self._snapshots = [
                self._parse_snapshot_row(row) for row in snapshots_df.collect()
            ]
        except Exception as e:
            logger.error(
                f"[{self._table_name}] snapshots collection failed", exc_info=True
            )
            self._errors["snapshot_collection"] = str(e)

        return FilesCollection(files=self._snapshots, errors=self._errors)

    def _query_snapshots_df(self) -> pyspark.sql.DataFrame:
        return (
            self._spark.sql(
                f"SELECT * FROM {self._table_name}.snapshots ORDER BY committed_at DESC"
            )
            .filter(F.col("committed_at") >= F.lit(str(self._start_snapshot_cutoff)))
            .filter(F.col("committed_at") <= F.lit(str(self._end_snapshot_cutoff)))
        )

    @staticmethod
    def _validate_snapshot_count(snapshots_df: pyspark.sql.DataFrame) -> None:
        if snapshots_df.count() > max_snapshots_to_compute:
            raise ValueError(
                f"Too many snapshots to compute. Maximum is {max_snapshots_to_compute}."
            )

    @staticmethod
    def _format_summary(summary: dict) -> str:
        return UI_NEWLINE.join(
            (
                f"{k}: {(int(v) / (1024 ** 3)):.5f} GB"
                if k.endswith("files-size")
                else f"{k}: {v}"
            )
            for k, v in summary.items()
        )

    def _parse_snapshot_row(self, snapshot) -> SnapshotRecord:
        return SnapshotRecord(
            type=FileType.SNAPSHOT.value,
            file_path=snapshot.manifest_list,
            timestamp=str(snapshot.committed_at),
            snapshot_id=snapshot.snapshot_id,
            parent_id=snapshot.parent_id,
            operation=snapshot.operation,
            summary=self._format_summary(snapshot.summary or {}),
            child_files=[],
        )
