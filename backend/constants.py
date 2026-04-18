from enum import Enum

MAX_NUMBER_OF_GRAPHS_TO_COMPUTE = 15

MAX_SNAPSHOTS_TO_SHOW = 2000

COMPUTE_CLEANUP_TIME_SECONDS = 12

APPLICATION_PORT = 5000

MAIN_BRANCH_ICEBERG_TABLE_NAME = "main"
UI_SECTION_NEWLINE = "\x00"
UI_NEWLINE = "\n"


class FileType(Enum):
    MAIN_METADATA = "main_metadata"
    METADATA = "metadata"
    SNAPSHOT = "snapshot"
    MANIFEST = "manifest"
    DATA = "data"
    POSITION_DELETE = "position_delete"
    EQUALITY_DELETE = "equality_delete"
