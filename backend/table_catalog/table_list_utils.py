import os
from contextlib import suppress
from typing import Optional

from pyspark.sql import SparkSession

from base_classes.utils import qualify_table_name
from constants import TABLE_LIST_INCLUDE_SESSION_CATALOG

table_list_include_session_catalog = str(os.getenv("TABLE_LIST_INCLUDE_SESSION_CATALOG", TABLE_LIST_INCLUDE_SESSION_CATALOG)).lower() == "true"


def get_spark_catalog_config_value(spark: SparkSession, catalog: str, suffix: str) -> Optional[str]:
    with suppress(Exception):
        return spark.conf.get(f"spark.sql.catalog.{catalog}{suffix}")
    return None


def default_catalog(spark: SparkSession) -> str:
    with suppress(Exception):
        return spark.catalog.currentCatalog()
    return "spark_catalog"


def is_iceberg_spark_catalog(spark: SparkSession, catalog: str) -> bool:
    impl = get_spark_catalog_config_value(spark, catalog, "") or ""
    return "org.apache.iceberg.spark.SparkCatalog" in impl and "SparkSessionCatalog" not in impl


def is_spark_session_catalog(spark: SparkSession, catalog: str) -> bool:
    impl = get_spark_catalog_config_value(spark, catalog, "") or ""
    return "SparkSessionCatalog" in impl


def should_include_catalog(spark: SparkSession, catalog: str) -> bool:
    if table_list_include_session_catalog:
        return True
    return not is_spark_session_catalog(spark, catalog)


def list_catalog_names(spark: SparkSession, default_catalog_name: str) -> list[str]:
    with suppress(Exception):
        catalogs = [catalog.name for catalog in spark.catalog.listCatalogs()]
        catalogs = [catalog for catalog in catalogs if catalog]
        if catalogs:
            return catalogs

    return [default_catalog_name]


def list_database_names(spark: SparkSession, catalog: str) -> list[str]:
    with suppress(Exception):
        databases = spark.catalog.listDatabases(catalog)
        names = [database.name for database in databases if database.name]
        if names:
            return names

    if catalog == default_catalog(spark):
        with suppress(Exception):
            databases = spark.catalog.listDatabases()
            names = [database.name for database in databases if database.name]
            if names:
                return names

        with suppress(Exception):
            current_database = spark.catalog.currentDatabase()
            if current_database:
                return [current_database]

    return ["default"]


def list_tables(spark: SparkSession, catalog: str, database: str) -> list:
    default_catalog_name = default_catalog(spark)

    with suppress(Exception):
        if catalog == default_catalog_name:
            return spark.catalog.listTables(database) or []

        tables = spark.catalog.listTables(database, catalog)
        if tables:
            return tables

    with suppress(Exception):
        return spark.catalog.listTables(database) or []

    return []


def collect_table_candidates(spark: SparkSession) -> set[str]:
    candidates: set[str] = set()
    default_catalog_name = default_catalog(spark)

    for catalog in list_catalog_names(spark, default_catalog_name):
        if not should_include_catalog(spark, catalog):
            continue

        for database in list_database_names(spark, catalog):
            for table in list_tables(spark, catalog, database):
                if table.isTemporary:
                    continue
                candidates.add(qualify_table_name(catalog, database, table.name, default_catalog_name))

    return candidates


def catalogs_are_iceberg_only(spark: SparkSession, catalog_names: list[str]) -> bool:
    included_catalogs = [catalog for catalog in catalog_names if should_include_catalog(spark, catalog)]
    if not included_catalogs:
        return False
    return all(is_iceberg_spark_catalog(spark, catalog) for catalog in included_catalogs)
