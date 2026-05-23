import os

from pyspark.sql import SparkSession


def open_spark_connect_session():
    """
    Opens a spark connect session.

    Sets the time zone of the session to UTC (this does not affect other sessions
    to the same spark connect server).

    Returns:
        SparkSession: The spark connect session.
    """

    session = SparkSession.builder.remote(os.environ["SPARK_REMOTE"]).getOrCreate()

    session.conf.set("spark.sql.session.timeZone", "UTC")

    return session
