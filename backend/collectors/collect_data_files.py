from constants import UI_NEWLINE
from utils import format_partition
from extractors.data_files_extractor import DataFilesAppearencesExtractor
from collectors.collect_manifests import ManifestRecord
from dataclasses import dataclass
from typing import List, Dict

from base_classes.base_file import BaseFile
from base_classes.collector import Collector
from base_classes.files_collection import FilesCollection
from constants import FileType
from utils import timed


@dataclass
class DataFileRecord(BaseFile):
    type: str
    format: str
    size_gb: str
    row_count: int
    partition: str
    sort_order_id: int
    split_offsets: str
    key_metadata: str
    equality_ids: str


class CollectDataFiles(Collector):
    def __init__(
        self,
        full_table_name: str,
        manifests: List[ManifestRecord],
    ):
        super().__init__(full_table_name)
        self._manifests = manifests
        self._errors: Dict[str, str] = {}

    @timed
    def collect(self) -> FilesCollection:
        data_files_extraction_result = DataFilesAppearencesExtractor(self._full_table_name, self._manifests).extract_dataframe()
        self._errors = data_files_extraction_result.errors

        data_files_rows = data_files_extraction_result.df.collect()
        self._data_files = [self._process_data_file_row(f) for f in data_files_rows]

        return FilesCollection(files=self._data_files, errors=self._errors)

    def _process_data_file_row(self, data_file_row) -> DataFileRecord:
        data_file_dict = data_file_row.asDict(recursive=True)

        return DataFileRecord(
            type=self._detect_file_type(data_file_dict["content"]),
            file_path=data_file_dict["file_path"],
            format=data_file_dict["file_format"],
            size_gb=f"{(data_file_dict['file_size_in_bytes'] / 1024 ** 3):.10f}",
            row_count=data_file_dict["record_count"],
            partition=format_partition(data_file_dict["partition"]),
            sort_order_id=data_file_dict["sort_order_id"],
            split_offsets=UI_NEWLINE.join(map(str, data_file_dict["split_offsets"] or [])),
            key_metadata=data_file_dict["key_metadata"],
            equality_ids=data_file_dict["equality_ids"],
        )

    def _detect_file_type(self, content: int) -> str:
        if content == 0:
            return FileType.DATA.value

        elif content == 1:
            return FileType.POSITION_DELETE.value

        return FileType.EQUALITY_DELETE.value
