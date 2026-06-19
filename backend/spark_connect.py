import os

from pyspark.sql import SparkSession

from icegraph_logger import logger


def open_spark_connect_session():
    return SparkSession.builder.remote(os.environ["SPARK_REMOTE"]).getOrCreate()


def close_spark_connect_session():
    spark = open_spark_connect_session()

    spark.interruptAll()
    spark.stop()

    logger.info("Spark disconnected")
