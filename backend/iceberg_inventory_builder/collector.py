from abc import ABC, abstractmethod

from iceberg_inventory_builder.files_collection import FilesCollection
from iceberg_inventory_builder.spark_table_action import SparkTableAction


class Collector(SparkTableAction, ABC):
    @abstractmethod
    def collect(self) -> FilesCollection:
        pass
