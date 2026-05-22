from abc import ABC, abstractmethod

from collectors.files_collection import FilesCollection
from base_classes.spark_table_action import SparkTableAction


class Collector(SparkTableAction, ABC):
    @abstractmethod
    def collect(self) -> FilesCollection:
        pass
