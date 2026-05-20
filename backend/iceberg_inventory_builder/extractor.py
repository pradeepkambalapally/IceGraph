from abc import ABC, abstractmethod

import pyspark

from dataclasses import dataclass, field
from typing import Dict
from iceberg_inventory_builder.spark_table_action import SparkTableAction


@dataclass(frozen=True)
class ExtractionResult:
    dataframe: pyspark.sql.DataFrame
    errors: Dict[str, str] = field(default_factory=dict)


class Extractor(SparkTableAction, ABC):
    @abstractmethod
    def extract_dataframe(self) -> ExtractionResult:
        pass
