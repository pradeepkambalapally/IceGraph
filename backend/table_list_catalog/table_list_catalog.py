import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import suppress
from dataclasses import dataclass
from typing import Optional

from pyspark.errors import AnalysisException

from base_classes.utils import timed, verify_iceberg_table
from constants import TABLE_LIST_CACHE_TTL_SECONDS
from spark_connect import open_spark_connect_session
from table_list_catalog.utils import (
    catalogs_are_iceberg_only,
    collect_table_candidates,
    default_catalog,
    list_catalog_names,
)

table_list_cache_ttl_seconds = int(os.getenv("TABLE_LIST_CACHE_TTL_SECONDS", TABLE_LIST_CACHE_TTL_SECONDS))


@dataclass
class CacheEntry:
    timestamp: float
    tables: list[str]


class TableListCatalog:
    _cache: Optional[CacheEntry] = None

    def __init__(self):
        self._spark = open_spark_connect_session()

    @timed
    def collect(self) -> list[str]:
        now = time.time()
        if TableListCatalog._cache and now - TableListCatalog._cache.timestamp < table_list_cache_ttl_seconds:
            return TableListCatalog._cache.tables

        candidates, iceberg_only = self._collect_candidates()
        if iceberg_only:
            result = sorted(candidates)
        else:
            result = sorted(self._filter_iceberg_tables(candidates))

        TableListCatalog._cache = CacheEntry(now, result)
        return result

    def _collect_candidates(self) -> tuple[set[str], bool]:
        default_catalog_name = default_catalog(self._spark)
        catalogs = list_catalog_names(self._spark, default_catalog_name)
        candidates = collect_table_candidates(self._spark)
        iceberg_only = catalogs_are_iceberg_only(self._spark, catalogs)
        return candidates, iceberg_only

    def _filter_iceberg_tables(self, candidates: set[str]) -> list[str]:
        if not candidates:
            return []

        if len(candidates) == 1:
            table = next(iter(candidates))
            return [table] if self._table_is_iceberg(table) else []

        loadable: list[str] = []
        max_workers = min(len(candidates), 8)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self._table_is_iceberg, table): table for table in candidates}
            for future in as_completed(futures):
                table = futures[future]
                if future.result():
                    loadable.append(table)

        return loadable

    @staticmethod
    def _table_is_iceberg(table_name: str) -> bool:
        with suppress(AnalysisException):
            verify_iceberg_table(table_name)
            return True
        return False
