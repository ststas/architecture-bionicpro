"""Проверки даты первого развёртывания без изменения существующих баз."""

from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import pendulum
from airflow.models import DagBag
from airflow.timetables.base import TimeRestriction

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import bootstrap_reports


class BootstrapReportsTests(unittest.TestCase):
    def test_first_start_uses_first_source_day(self):
        with patch.object(bootstrap_reports.Variable, "get", return_value=None), \
             patch.object(bootstrap_reports.Variable, "set") as store, \
             patch.object(bootstrap_reports, "PostgresHook") as source:
            source.return_value.get_first.return_value = (date(2034, 7, 22),)
            self.assertEqual(bootstrap_reports.bootstrap_reports(), "2034-07-22")
            store.assert_called_once_with("reports_etl_start_date", "2034-07-22")

    def test_restart_keeps_original_date(self):
        saved = {}
        with patch.object(bootstrap_reports.Variable, "get", side_effect=lambda key, default_var=None: saved.get(key, default_var)), \
             patch.object(bootstrap_reports.Variable, "set", side_effect=saved.__setitem__) as store, \
             patch.object(bootstrap_reports, "PostgresHook") as source:
            source.return_value.get_first.return_value = (date(2034, 7, 22),)
            first = bootstrap_reports.bootstrap_reports()
            source.return_value.get_first.return_value = (date(2034, 8, 10),)
            self.assertEqual(bootstrap_reports.bootstrap_reports(), first)
            store.assert_called_once()
            source.return_value.get_first.assert_called_once()

    def test_empty_source_does_not_save_a_wrong_date(self):
        with patch.object(bootstrap_reports.Variable, "get", return_value=None), \
             patch.object(bootstrap_reports.Variable, "set") as store, \
             patch.object(bootstrap_reports, "PostgresHook") as source:
            source.return_value.get_first.return_value = (None,)
            with self.assertRaises(RuntimeError):
                bootstrap_reports.bootstrap_reports()
            store.assert_not_called()

    def test_dag_schedules_ten_complete_days_for_different_deployments(self):
        dag_path = Path(__file__).resolve().parents[1] / "dags" / "bionicpro_reports_etl.py"
        for deployment_day in ["2026-11-14", "2034-08-01"]:
            with self.subTest(deployment_day=deployment_day):
                today = pendulum.parse(deployment_day, tz="UTC")
                first_day = today.subtract(days=10)
                with patch("airflow.models.Variable.get", return_value=first_day.to_date_string()):
                    bag = DagBag(dag_folder=str(dag_path), include_examples=False)
                self.assertFalse(bag.import_errors)
                dag = bag.dags["bionicpro_reports_etl"]
                self.assertEqual(dag.start_date, first_day)
                self.assertTrue(dag.catchup)
                restriction = TimeRestriction(earliest=first_day, latest=today.subtract(days=1), catchup=True)
                previous = None
                intervals = []
                while True:
                    run = dag.timetable.next_dagrun_info(last_automated_data_interval=previous, restriction=restriction)
                    if run is None:
                        break
                    intervals.append(run.data_interval)
                    previous = run.data_interval
                    self.assertLessEqual(len(intervals), 10)
                self.assertEqual(len(intervals), 10)
                self.assertEqual(intervals[0].start, first_day)
                self.assertEqual(intervals[-1].end, today)


if __name__ == "__main__":
    unittest.main()
