from abc import ABC, abstractmethod

from iceberg_inventory_builder.files_collection import FilesCollection
from spark_connect import open_spark_connect_session


class Collector(ABC):
    def __init__(
        self,
        full_table_name: str,
    ):
        self._spark = open_spark_connect_session()
        self._table_name = full_table_name

    @abstractmethod
    def collect(self) -> FilesCollection:
        pass
