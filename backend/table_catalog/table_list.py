import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import suppress
from typing import Optional

from pyspark.errors import AnalysisException
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from base_classes.utils import get_spark_row_value, is_iceberg_table, qualify_table_name, timed
from constants import TABLE_LIST_CACHE_TTL_SECONDS
from spark_connect import open_spark_connect_session

table_list_cache_ttl_seconds = int(os.getenv("TABLE_LIST_CACHE_TTL_SECONDS", TABLE_LIST_CACHE_TTL_SECONDS))


def _namespace_to_str(namespace) -> str:
    if isinstance(namespace, (list, tuple)):
        return ".".join(str(part) for part in namespace)
    return str(namespace)


def _sql_ident(*parts: str) -> str:
    return ".".join(f"`{part}`" for part in parts if part)


def _get_spark_catalog_config_value(spark: SparkSession, catalog: str, suffix: str) -> Optional[str]:
    with suppress(Exception):
        return spark.conf.get(f"spark.sql.catalog.{catalog}{suffix}")
    return None


def _default_catalog(spark: SparkSession) -> str:
    with suppress(Exception):
        return spark.catalog.currentCatalog()
    return "spark_catalog"


def _is_iceberg_spark_catalog(spark: SparkSession, catalog: str) -> bool:
    impl = _get_spark_catalog_config_value(spark, catalog, "") or ""
    return "org.apache.iceberg.spark.SparkCatalog" in impl and "SparkSessionCatalog" not in impl


def _list_catalogs(spark: SparkSession, default_catalog: str) -> list[str]:
    catalogs: list[str] = []
    with suppress(AnalysisException):
        catalogs = [get_spark_row_value(row, "catalog") for row in spark.sql("SHOW CATALOGS").collect()]

    catalogs = [catalog for catalog in catalogs if catalog]
    return catalogs or [default_catalog]


def _collect_namespace_rows(spark: SparkSession, query: str) -> list[str]:
    namespaces: list[str] = []
    seen: set[str] = set()

    with suppress(AnalysisException):
        for row in spark.sql(query).collect():
            namespace = _namespace_to_str(
                get_spark_row_value(row, "namespace", "namespace_name", "databaseName")
            )
            if namespace and namespace not in seen:
                seen.add(namespace)
                namespaces.append(namespace)

    return namespaces


def _list_namespaces(spark: SparkSession, catalog: str, default_catalog: str) -> list[str]:
    namespaces = _collect_namespace_rows(spark, f"SHOW NAMESPACES IN {_sql_ident(catalog)}")
    if namespaces:
        return namespaces

    if catalog == default_catalog:
        namespaces = _collect_namespace_rows(spark, "SHOW NAMESPACES")
        if namespaces:
            return namespaces

        namespaces = _collect_namespace_rows(spark, "SHOW DATABASES")
        if namespaces:
            return namespaces

    with suppress(Exception):
        current_database = spark.catalog.currentDatabase()
        if current_database:
            return [current_database]

    return ["default"]


def _collect_table_names_from_query(
    spark: SparkSession,
    query: str,
    catalog: str,
    namespace: str,
    default_catalog: str,
) -> set[str]:
    tables: set[str] = set()

    with suppress(AnalysisException):
        df = spark.sql(query)
        if "isTemporary" in df.columns:
            df = df.filter(~F.col("isTemporary"))

        for row in df.collect():
            table_name = get_spark_row_value(row, "tableName", "table")
            if table_name:
                tables.add(qualify_table_name(catalog, namespace, table_name, default_catalog))

    return tables


def _collect_table_candidates_from_sql(
    spark: SparkSession,
    catalog: str,
    namespace: str,
    default_catalog: str,
) -> set[str]:
    tables = _collect_table_names_from_query(
        spark,
        f"SHOW TABLES IN {_sql_ident(catalog, namespace)}",
        catalog,
        namespace,
        default_catalog,
    )
    if tables:
        return tables

    if catalog == default_catalog:
        return _collect_table_names_from_query(
            spark,
            f"SHOW TABLES IN {_sql_ident(namespace)}",
            catalog,
            namespace,
            default_catalog,
        )

    return tables


class TableListCollector:
    _cache: Optional[tuple[float, list[str]]] = None

    def __init__(self):
        self._spark = open_spark_connect_session()

    @timed
    def collect(self) -> list[str]:
        now = time.time()
        if (
            TableListCollector._cache
            and now - TableListCollector._cache[0] < table_list_cache_ttl_seconds
        ):
            return TableListCollector._cache[1]

        candidates, iceberg_only = self._collect_candidates()
        if iceberg_only:
            result = sorted(candidates)
        else:
            result = sorted(self._filter_iceberg_tables(candidates))

        TableListCollector._cache = (now, result)
        return result

    def _collect_candidates(self) -> tuple[set[str], bool]:
        candidates: set[str] = set()
        default_catalog = _default_catalog(self._spark)
        catalogs = _list_catalogs(self._spark, default_catalog)
        iceberg_only = all(_is_iceberg_spark_catalog(self._spark, catalog) for catalog in catalogs)

        for catalog in catalogs:
            for namespace in _list_namespaces(self._spark, catalog, default_catalog):
                candidates.update(
                    _collect_table_candidates_from_sql(self._spark, catalog, namespace, default_catalog)
                )

        return candidates, iceberg_only

    def _filter_iceberg_tables(self, candidates: set[str]) -> list[str]:
        if not candidates:
            return []

        if len(candidates) == 1:
            table = next(iter(candidates))
            return [table] if is_iceberg_table(self._spark, table) else []

        loadable: list[str] = []
        max_workers = min(len(candidates), 8)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(is_iceberg_table, self._spark, table): table for table in candidates
            }
            for future in as_completed(futures):
                table = futures[future]
                if future.result():
                    loadable.append(table)

        return loadable


def collect_table_list() -> list[str]:
    return TableListCollector().collect()
