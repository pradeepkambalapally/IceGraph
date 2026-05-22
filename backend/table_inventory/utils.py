import json
from contextlib import suppress
from typing import Any, Dict, List

from pyspark.sql import SparkSession


def format_schemas_to_full_dict(schemas: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    formatted_schemas = []
    for schema in schemas:
        formatted_schema = schema.copy()
        for field in formatted_schema["fields"]:
            with suppress(Exception):
                field["type"] = json.loads(field["type"])

        formatted_schemas.append(formatted_schema)

    return formatted_schemas


def get_json_metadata_from_path(metadata_path: str) -> Dict[str, Any]:
    spark = SparkSession.builder.getOrCreate()

    row = (
        spark.read.option("multiLine", True)
        .json(metadata_path)
        .drop("metadata-log")
        .drop("snapshot-log")
        .drop("snapshots")
        .drop("statistics")
        .first()
    )

    return row.asDict(recursive=True)
