from abc import ABC, abstractmethod

import pyspark

from iceberg_inventory_builder.spark_table_action import SparkTableAction


class Extractor(SparkTableAction, ABC):
    @abstractmethod
    def extract_dataframe(self) -> pyspark.sql.DataFrame:
        pass
