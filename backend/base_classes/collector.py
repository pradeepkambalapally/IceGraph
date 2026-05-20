from abc import ABC, abstractmethod

from base_classes.files_collection import FilesCollection
from base_classes.spark_table_action import SparkTableAction


class Collector(SparkTableAction, ABC):
    @abstractmethod
    def collect(self) -> FilesCollection:
        pass
