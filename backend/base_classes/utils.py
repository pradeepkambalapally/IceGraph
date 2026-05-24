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


def column_to_string_utc(column_name):
    return F.date_format(F.col(column_name), "yyyy-MM-dd'T'HH:mm:ss.SSS")
