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


def verify_iceberg_table(table_name: str) -> bool:
    with suppress(AnalysisException, AttributeError, IndexError):
        spark = SparkSession.builder.getOrCreate()

        df_desc = spark.sql(f"DESCRIBE FORMATTED {table_name}")
        provider_row = df_desc.filter(df_desc.col_name == "Provider").collect()

        if provider_row:
            provider_value = provider_row[0].data_type.lower().strip()
            return provider_value == "iceberg"

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
