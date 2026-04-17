import re
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from pyspark.errors import AnalysisException

from constants import (
    APPLICATION_PORT,
    COMPUTE_CLEANUP_TIME_SECONDS,
    MAX_NUMBER_OF_GRAPHS_TO_COMPUTE,
)
from iceberg_inventory_builder import IcebergInventoryBuilder
from iceberg_metadata_snapshot_map import collect_snapshot_map
from icegraph_logger import logger
from icegraph_data_normalizer import normalize_graph_data
from utils import verify_iceberg_table

load_dotenv()
app = Flask(__name__, static_url_path="/static")

job_lock = threading.Lock()
jobs: dict[str, dict] = {}

executor_pool = ThreadPoolExecutor(max_workers=MAX_NUMBER_OF_GRAPHS_TO_COMPUTE)


def _safe_update_job(job_id, **fields):
    with job_lock:
        if job_id in jobs:
            jobs[job_id].update(fields)


def _cleanup_in_flight(job_id):
    with job_lock:
        jobs.pop(job_id, None)
    logger.info(f"Removed in-flight key {job_id}")


def _schedule_cleanup(job_id):
    threading.Timer(
        COMPUTE_CLEANUP_TIME_SECONDS,
        lambda job_id=job_id: _cleanup_in_flight(job_id),
    ).start()


def _compute_graph_background(job_id, table_name, start_snapshot_id, end_snapshot_id):
    try:
        table_data = IcebergInventoryBuilder(
            table_name, start_snapshot_id, end_snapshot_id
        ).collect()

        result = normalize_graph_data(table_data)

        _safe_update_job(job_id, status="completed", result=result)
        logger.info(f"Job {job_id} completed")

    except AnalysisException as e:
        logger.error(f"Spark Error in job {job_id}: {e}\n{traceback.format_exc()}")
        _safe_update_job(job_id, status="failed", error=str(e))

    except Exception as e:
        logger.error(f"Unexpected error in job {job_id}: {e}\n{traceback.format_exc()}")
        _safe_update_job(job_id, status="failed", error=str(e))

    finally:
        _schedule_cleanup(job_id)


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    static_path = Path(app.static_folder).resolve()
    requested_path = (static_path / path).resolve()

    if requested_path.is_file():
        return send_from_directory(static_path, path)

    return send_from_directory(static_path, "index.html")


@app.route("/api/v1/snapshot-map/<path:table_name>", methods=["GET"])
def snapshot_map(table_name):
    try:
        verify_iceberg_table(table_name)

        result = collect_snapshot_map(table_name)

        return jsonify(result)

    except AnalysisException as e:
        logger.error(f"Spark Error: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 400

    except Exception as e:
        logger.error(f"Unexpected error: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/v1/graph-data", methods=["POST"])
def graph_data():
    table_name = request.form.get("table_name")
    start_snapshot_id = request.form.get("start_snapshot_id")
    if start_snapshot_id:
        start_snapshot_id = int(start_snapshot_id)
    end_snapshot_id = request.form.get("end_snapshot_id")
    if end_snapshot_id:
        end_snapshot_id = int(end_snapshot_id)

    try:
        verify_iceberg_table(table_name)
    except AnalysisException as e:
        logger.error(f"Spark Error: {e}\n{traceback.format_exc()}")
        return jsonify({"error": str(e)}), 400

    key_table_name = table_name.replace(".", "_")
    job_id = re.sub(
        r"[^a-zA-Z0-9_]",
        "",
        f"{key_table_name}_{start_snapshot_id}_{end_snapshot_id}",
    )

    response = {"key": job_id, "status": "processing"}

    with job_lock:
        if job_id in jobs:
            logger.info(f"Duplicate request for {job_id}")
            return jsonify(response), 202

        jobs[job_id] = response

    executor_pool.submit(
        _compute_graph_background,
        job_id,
        table_name,
        start_snapshot_id,
        end_snapshot_id,
    )

    logger.info(f"Submitted job {job_id}")
    return jsonify(response), 202


@app.route("/api/v1/graph-data/<job_id>", methods=["GET"])
def get_job_status(job_id):
    with job_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"error": "Job not found"}), 404

        job = job.copy()

    status = job["status"]

    if status == "completed":
        return jsonify(job["result"]), 200

    elif status == "failed":
        return jsonify({"error": job.get("error", "Unknown error")}), 400

    else:
        return jsonify(job), 202


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=APPLICATION_PORT)
