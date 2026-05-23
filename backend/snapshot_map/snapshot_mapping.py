from typing import Dict

import arrow

from spark_connect import open_spark_connect_session


def collect_snapshot_map(full_table_name: str, max_snapshots_to_show: int) -> Dict[str, Dict[str, str]]:
    spark = open_spark_connect_session()

    spark_tz = spark.conf.get("spark.sql.session.timeZone")

    df = spark.sql(f"""
        SELECT
            date_format(committed_at, "yyyy-MM-dd'T'HH:mm:ss.SSS") AS snapshot_timestamp,
            snapshot_id,operation
        FROM {full_table_name}.snapshots
        ORDER BY committed_at DESC
    """).limit(max_snapshots_to_show)

    return {
        arrow.get(row.snapshot_timestamp).replace(tzinfo=spark_tz).isoformat(): {"snapshot_id": str(row.snapshot_id), "operation": row.operation}
        for row in df.collect()
    }
