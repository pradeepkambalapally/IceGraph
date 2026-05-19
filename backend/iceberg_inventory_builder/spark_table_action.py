from abc import ABC

from spark_connect import open_spark_connect_session


class SparkTableAction(ABC):
    def __init__(
        self,
        full_table_name: str,
    ):
        self._spark = open_spark_connect_session()
        self._table_name = full_table_name
