from constants import STANDART_DATE_FORMAT
from spark_connect import open_spark_connect_session
import functools
import inspect
import time
from contextlib import suppress

import arrow
from pyspark.errors import AnalysisException
from pyspark.sql import functions as F
from pyspark.sql import SparkSession

from icegraph_logger import logger


def timed(fn):
    signature = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.time()

        bound = signature.bind_partial(*args, **kwargs)
        table_name = bound.arguments.get("table_name")
        if not table_name and (obj := bound.arguments.get("self")):
            table_name = getattr(
                obj,
                "_table_name",
                None,
            ) or getattr(obj, "table_name", None)

        result = fn(*args, **kwargs)

        prefix = f"[{table_name}] " if table_name else ""
        logger.info(f"{prefix}{fn.__qualname__} took {time.time() - start:.2f}s")

        return result

    return wrapper


def get_spark_row_value(row, *names):
    for name in names:
        value = getattr(row, name, None)
        if value is None and hasattr(row, "__getitem__"):
            with suppress(Exception):
                value = row[name]
        if value is not None:
            return value
    return None


def qualify_table_name(catalog: str, namespace: str, table: str, default_catalog: str) -> str:
    if catalog == default_catalog:
        return f"{namespace}.{table}"
    return f"{catalog}.{namespace}.{table}"


def verify_iceberg_table(table_name: str) -> bool:
    spark = open_spark_connect_session()

    with suppress(AnalysisException, AttributeError, IndexError):
        provider_row = spark.sql(f"DESCRIBE FORMATTED {table_name}").filter(F.col("col_name") == "Provider").collect()
        if provider_row:
            return provider_row[0].data_type.lower().strip() == "iceberg"

    raise AnalysisException(f"Table '{table_name}' is not an Iceberg table.")


def to_arrow_utc(timestamp):
    return arrow.get(timestamp).replace(tzinfo="UTC")


def column_to_string_utc(column_name: str):
    """
    Converts a timestamp column to a string in UTC format.

    Note: In case of daylight saving time, as the timezone is changed, the timestamp will be converted to UTC and then back to the local time. This can on the hour of the shift cause incorrect results.

    Args:
        column_name: The name of the column to convert.

    Returns:
        pyspark.sql.functions.Column: The converted column.
    """
    session = open_spark_connect_session()
    local_tz = session.conf.get("spark.sql.session.timeZone")

    string_column_with_local_tz = F.date_format(F.col(column_name), STANDART_DATE_FORMAT)
    timestamp_column_at_utc = F.to_utc_timestamp(string_column_with_local_tz, local_tz)

    return F.date_format(timestamp_column_at_utc, STANDART_DATE_FORMAT)
